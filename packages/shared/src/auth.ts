/**
 * JWT claim shape + access/refresh token DTOs (FR-22, FR-23, ADR 0004, AR-4).
 *
 * Single shared secret (`JWT_SECRET`). HS256 only. v1 has no key rotation.
 * Any introduction of JWKS / RS256 is a v2 contract change.
 */
import { z } from "zod";

export const JwtAudienceSchema = z.enum(["device", "simulator", "user"]);
export type JwtAudience = z.infer<typeof JwtAudienceSchema>;

/** Device-token scope: write telemetry only. Cannot reach admin endpoints (I-4). */
export const DeviceTokenScopeSchema = z.literal("telemetry:write");
/** Simulator-token scope: write telemetry only, no admin reach (I-3, I-4, FR-35). */
export const SimulatorTokenScopeSchema = z.literal("telemetry:write");
/** User-token scopes (Operator / Technician / Admin / Viewer). */
export const UserTokenScopeSchema = z.string().min(1);

export const JwtClaimsSchema = z.object({
  iss: z.literal("surakkha-api"),
  aud: JwtAudienceSchema,
  sub: z.string().uuid(),
  scope: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
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