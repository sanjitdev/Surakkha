/**
 * JWT issuance + verification for the Surakkha api.
 *
 * HS256, single shared secret (`JWT_SECRET`), `iss: surakkha-api`.
 * `JWT_SECRET` is validated eagerly by `assertJwtSecret()` at the api
 * entry point; tests can inject a deterministic secret via env.
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
    throw new Error("JWT_SECRET missing or weak");
  }
  return secret;
};

export const assertJwtSecret = (): string => {
  const secret = process.env["JWT_SECRET"];
  if (secret === undefined || secret.length < JWT_SECRET_MIN_LENGTH) {
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

export const verifyAccessToken = (token: string): JwtClaims | null => {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    return decoded as JwtClaims;
  } catch {
    return null;
  }
};

/**
 * Claim-driven verifier for the WS ingest endpoint. Returns a
 * discriminated `VerifyIngestResult` so the WS handler can emit a
 * distinct envelope per failure mode.
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
    return { kind: "sig_fail" };
  }
  if (typeof decoded !== "object" || decoded === null) return { kind: "sig_fail" };
  const claims = decoded as Partial<JwtClaims>;

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
