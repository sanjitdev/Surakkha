/**
 * JWT issuance + verification — Surakkha api (Story 1.4).
 *
 * Wire contract (Story 1.4 AC + `docs/architecture.md` §3.4):
 *   - HS256, single shared secret (`JWT_SECRET`)
 *   - `iss: surakkha-api`
 *   - `aud: user` for human sessions (the audience literal matches
 *     the `JwtAudienceSchema` enum in `@surakkha/shared/auth`)
 *   - `sub`: the user UUID
 *   - `scope`: default `user:read`
 *   - `exp`: now + 8 hours (USER_ACCESS_TOKEN_TTL_SECONDS)
 *
 * `JWT_SECRET` is validated eagerly by `assertJwtSecret()` at the api
 * entry point; this module reads from the same env var via
 * `getJwtSecret()` so a unit test can inject a deterministic secret.
 */
import {
  JWT_SECRET_MIN_LENGTH,
  type JwtAudience,
  type JwtClaims,
  USER_ACCESS_TOKEN_TTL_SECONDS,
  USER_TOKEN_DEFAULT_SCOPE,
} from "@surakkha/shared/auth";
import { type Role } from "@surakkha/shared/rbac";
import jwt from "jsonwebtoken";

export const JWT_ISSUER = "surakkha-api" as const;

const getSecret = (): string => {
  const secret = process.env["JWT_SECRET"];
  if (secret === undefined || secret.length < JWT_SECRET_MIN_LENGTH) {
    // Should be unreachable: `assertJwtSecret()` runs at boot and the
    // process exits on missing/weak secrets. This guard exists so the
    // runtime type of `getSecret()` is `string` without an `| undefined`.
    throw new Error("JWT_SECRET missing or weak");
  }
  return secret;
};

export const assertJwtSecret = (): string => {
  const secret = process.env["JWT_SECRET"];
  if (secret === undefined || secret.length < JWT_SECRET_MIN_LENGTH) {
    // Fail-fast (Story 1.4 AC + FR-25): exit code 1, log the reason.
    // The general rule against process.exit() is for runtime shutdown;
    // here we want a hard exit before any socket is bound.
    console.error("JWT_SECRET missing or weak");
    // eslint-disable-next-line no-restricted-properties
    process.exit(1);
  }
  return secret;
};

export interface IssueAccessTokenInput {
  readonly userId: string;
  readonly audience?: JwtAudience;
  readonly scope?: string;
  /**
   * Story 1.7: optional `role` claim (Admin / Operator / Technician /
   * Viewer). The role is omitted from device + simulator tokens
   * (audience !== "user") so the SPA's `CurrentRoleContext` can derive
   * the role from the JWT alone — no `/me` round-trip on page reload.
   */
  readonly role?: Role;
}

export const issueAccessToken = (
  input: IssueAccessTokenInput,
): { readonly token: string; readonly expiresIn: number } => {
  const basePayload = {
    iss: JWT_ISSUER,
    aud: input.audience ?? "user",
    sub: input.userId,
    scope: input.scope ?? USER_TOKEN_DEFAULT_SCOPE,
  };
  const payload = input.role === undefined ? basePayload : { ...basePayload, role: input.role };
  const token = jwt.sign(payload, getSecret(), {
    algorithm: "HS256",
    expiresIn: USER_ACCESS_TOKEN_TTL_SECONDS,
  });
  return { token, expiresIn: USER_ACCESS_TOKEN_TTL_SECONDS };
};

/**
 * Mint a refresh-token value (opaque random string). v1 keeps it
 * stateless — the value is signed by the same JWT mechanism so the
 * `/auth/refresh` handler can verify the cookie without a database
 * lookup. v2 may move refresh tokens into the database with a
 * revocation list.
 */
export const issueRefreshToken = (userId: string): string =>
  jwt.sign({ sub: userId, kind: "refresh" }, getSecret(), { algorithm: "HS256", expiresIn: "30d" });

export const verifyRefreshToken = (token: string): { readonly userId: string } | null => {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "sub" in decoded &&
      "kind" in decoded &&
      (decoded as { kind: unknown }).kind === "refresh" &&
      typeof (decoded as { sub: unknown }).sub === "string"
    ) {
      return { userId: (decoded as { sub: string }).sub };
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Verify an access token and return its claims. Used by Story 1.5's
 * auth middleware. Exported here so unit tests can exercise the
 * verifier independently of the route handlers.
 */
export const verifyAccessToken = (token: string): JwtClaims | null => {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    return decoded as JwtClaims;
  } catch {
    return null;
  }
};

/**
 * Story 2.2 — claim-driven verifier for the WS ingest endpoint.
 *
 * Devices and simulators are NOT role subjects (architecture §3.4,
 * I-3, I-4). Wrapping the WS upgrade with the HTTP `authenticate()`
 * middleware would reject every device connection because that
 * middleware looks up the `sub` as a `User` row. This sibling
 * verifier checks the *claims* only — HS256 + audience + scope +
 * `sub === urlDeviceId` — and returns the parsed claims so the
 * connection handler can attach them to the socket.
 *
 * Returns a discriminated `VerifyIngestResult` so the WS handler
 * can emit a distinct envelope per failure mode (F-P1): signature
 * failure and audience-rejection both fold into `unauthenticated`
 * (the token was either not signed by us or was issued for a
 * non-ingest audience); scope mismatch and `sub` mismatch fold
 * into `auth_error` with code `device_id_mismatch` (the token
 * passed signature + audience but does not authorise THIS device).
 * Before this change the handler emitted `device_id_mismatch` for
 * every failure, which mislead devices debugging wrong-scope or
 * wrong-audience issues.
 */
const INGEST_ALLOWED_AUDIENCES = ["device", "simulator"] as const;
const INGEST_REQUIRED_SCOPE = "telemetry:write";

export type VerifyIngestResult =
  | { readonly kind: "ok"; readonly claims: JwtClaims }
  | { readonly kind: "sig_fail" }
  | { readonly kind: "aud_fail" }
  | { readonly kind: "scope_fail" }
  | { readonly kind: "sub_mismatch" };

export const verifyIngestClaims = (token: string, expectedSub: string): VerifyIngestResult => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, getSecret(), {
      algorithms: ["HS256"],
      clockTolerance: 30,
      issuer: JWT_ISSUER,
    });
  } catch {
    // Signature / expiry / format failure — caller emits
    // "unauthenticated" (I-1).
    return { kind: "sig_fail" };
  }
  if (typeof decoded !== "object" || decoded === null) return { kind: "sig_fail" };
  const claims = decoded as Partial<JwtClaims>;

  // Structural checks. The JWT library already verified `iss` and
  // `exp` against the registered claims; we layer the application-
  // specific shape on top so the WS endpoint never accepts a `user`
  // audience (I-3). Sub-check runs LAST so a wrong-sub token still
  // surfaces an accurate envelope if scope/aud were also wrong.
  if (typeof claims.aud !== "string") return { kind: "sig_fail" };
  if (!(INGEST_ALLOWED_AUDIENCES as readonly string[]).includes(claims.aud)) {
    return { kind: "aud_fail" };
  }
  if (claims.scope !== INGEST_REQUIRED_SCOPE) {
    return { kind: "scope_fail" };
  }
  if (typeof claims.sub !== "string" || claims.sub !== expectedSub) {
    return { kind: "sub_mismatch" };
  }

  return { kind: "ok", claims: claims as JwtClaims };
};
