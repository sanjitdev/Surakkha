/**
 * JWT claim shape + access/refresh token DTOs (FR-22, FR-23, ADR 0004, AR-4).
 *
 * Single shared secret (`JWT_SECRET`). HS256 only. v1 has no key rotation.
 * Any introduction of JWKS / RS256 is a v2 contract change.
 */
import { z } from "zod";

import { RoleSchema } from "./rbac.js";

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