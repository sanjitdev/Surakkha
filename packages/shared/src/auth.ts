/**
 * JWT claim shape + access/refresh token DTOs (FR-22, FR-23, ADR 0004, AR-4).
 *
 * Single shared secret (`JWT_SECRET`). HS256 only. v1 has no key rotation.
 * Any introduction of JWKS / RS256 is a v2 contract change.
 */
import { z } from "zod";

import { RoleSchema } from "./rbac.js";
import { UUID_V4_REGEX } from "./schemas.js";

export const JwtAudienceSchema = z.enum(["device", "simulator", "user"]);
export type JwtAudience = z.infer<typeof JwtAudienceSchema>;

/** Device-token scope: write telemetry only. Cannot reach admin endpoints (I-4). */
export const DeviceTokenScopeSchema = z.literal("telemetry:write");
/** Simulator-token scope: write telemetry only, no admin reach (I-3, I-4, FR-35). */
export const SimulatorTokenScopeSchema = z.literal("telemetry:write");
/** User-token scopes (Operator / Technician / Admin / Viewer). */
export const UserTokenScopeSchema = z.string().min(1);

/**
 * Standard registered claims plus Story 1.7's `role` claim. The `role`
 * is stamped into user-access tokens (Story 1.7) so the SPA can decode
 * the role synchronously from `localStorage` without an extra `/me`
 * round-trip on every page reload; device / simulator tokens do NOT
 * carry `role` (they're scoped to telemetry:write with no UI role).
 */
export const JwtClaimsSchema = z.object({
  iss: z.literal("surakkha-api"),
  aud: JwtAudienceSchema,
  sub: z.string().uuid(),
  scope: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  role: RoleSchema.optional(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export const AccessTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
});
export type AccessToken = z.infer<typeof AccessTokenSchema>;

/** Refresh token is delivered only as an httpOnly cookie (FR-23). */
export const REFRESH_TOKEN_COOKIE = "surakkha_refresh" as const;

/** Fail-fast minimum length (Story 1.4 AC). */
export const JWT_SECRET_MIN_LENGTH = 32 as const;

/**
 * User-access-token TTL in seconds (Story 1.4 AC: "8-hour expiry").
 * Device tokens get 24h and simulator tokens get 1h (`docs/architecture.md`
 * §3.4) — those are minted by Story 2.2 / 3.5, not the web login flow.
 */
export const USER_ACCESS_TOKEN_TTL_SECONDS = 28800;

/** Refresh-token TTL in seconds (long-lived; refreshed silently). */
export const REFRESH_TOKEN_TTL_SECONDS = 2592000;

/**
 * Cookie attributes for the refresh token (Story 1.4 AC: httpOnly,
 * SameSite=Strict, scoped to the api origin). `Path=/auth` ensures the
 * cookie is only sent on refresh requests; v2 may move to `/api/auth`.
 *
 * Exported as a function so the `secure` flag is computed at request
 * time (the env var is not known at module-load and we want the type
 * to match Express's `CookieOptions`).
 */
export interface RefreshTokenCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "strict";
  readonly path: "/auth";
  readonly secure: boolean;
}

export const refreshTokenCookieOptions = (): RefreshTokenCookieOptions => ({
  httpOnly: true,
  sameSite: "strict",
  path: "/auth",
  secure: process.env["NODE_ENV"] === "production",
});

/** Default scope string for a signed-in human user. */
export const USER_TOKEN_DEFAULT_SCOPE = "user:read" as const;

/**
 * TTLs (seconds) for device and simulator access tokens, per
 * architecture §3.4. Story 1.10 invariant: HS256, single secret, no
 * rotation. Story 2.2 / 3.5 mint at the call site using these.
 */
export const SIMULATOR_TOKEN_TTL_SECONDS = 3600;
export const DEVICE_TOKEN_TTL_SECONDS = 86400;

/**
 * Validate that `sub` is a UUIDv4 string. The regex pins BOTH the
 * version nibble (3rd group MUST start with `4`) AND the variant nibble
 * (4th group MUST start with `8-b`); the previous variant-only check
 * accepted valid UUIDv1 with a `8-b` variant nibble (e.g. `…-1234-1234-
 * 8def-…`). We re-parse through `JwtClaimsSchema` after building the
 * claim so a bad `sub` from the caller fails fast at the call site
 * instead of producing a token that the verifier will reject later.
 */
const assertUuidV4 = (sub: string): void => {
  // Version nibble = `4`, variant nibble = `[89ab]`. The regex
  // lives in `./schemas.js` so every consumer (this file, the api
  // routers, the simulator) sees one literal.
  if (!UUID_V4_REGEX.test(sub)) {
    throw new Error(`simulator/device claim template: sub must be a UUIDv4 (got ${sub})`);
  }
};

/**
 * Build a claim *template* (NOT a signed JWT) for the simulator process.
 * Signing happens at the call site with `JWT_SECRET`; the shared package
 * must not touch `process.env`. The returned object re-parses cleanly
 * through `JwtClaimsSchema.parse()` and is frozen so a caller cannot
 * mutate the claim before signing without triggering a TypeError at
 * assignment time.
 */
export const simulatorClaimTemplate = (sub: string): Readonly<JwtClaims> => {
  assertUuidV4(sub);
  const iat = Math.floor(Date.now() / 1000);
  const claim: JwtClaims = {
    iss: "surakkha-api",
    aud: "simulator",
    sub,
    scope: "telemetry:write",
    iat,
    exp: iat + SIMULATOR_TOKEN_TTL_SECONDS,
  };
  const parsed = JwtClaimsSchema.parse(claim);
  return Object.freeze(parsed);
};

/**
 * Build a claim template for a real device. Same env-independence as
 * `simulatorClaimTemplate`; 24-hour TTL per architecture §3.4.
 */
export const deviceClaimTemplate = (sub: string): Readonly<JwtClaims> => {
  assertUuidV4(sub);
  const iat = Math.floor(Date.now() / 1000);
  const claim: JwtClaims = {
    iss: "surakkha-api",
    aud: "device",
    sub,
    scope: "telemetry:write",
    iat,
    exp: iat + DEVICE_TOKEN_TTL_SECONDS,
  };
  const parsed = JwtClaimsSchema.parse(claim);
  return Object.freeze(parsed);
};
