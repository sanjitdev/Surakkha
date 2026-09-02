/**
 * `jwtDecode` — extracts `role`, `sub`, and `exp` from the access token
 * payload. Signature verification is the api's job; the client only
 * needs the role for nav rendering (avoids a `/me` round-trip on
 * page reload). Returns nulls on any shape mismatch.
 */
import { type Role } from "@surakkha/shared/rbac";

export interface DecodedAccessToken {
  readonly role: Role | null;
  readonly userId: string | null;
  readonly expiresAt: number | null;
}

const decodeBase64Url = (input: string): string => {
  // base64url → base64. Pad to a multiple of 4, swap `-_` → `+/`.
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  // happy-dom and jsdom both expose atob in the test env; the browser
  // has it as a global. We use globalThis.atob for the broadest fit.
  return globalThis.atob(padded);
};

const ROLE_VALUES: readonly Role[] = ["Admin", "Operator", "Technician", "Viewer"];

const asRole = (value: unknown): Role | null =>
  ROLE_VALUES.includes(value as Role) ? (value as Role) : null;

const asUserId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asExpiresAt = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const extractPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  const JWT_PARTS = 3;
  if (parts.length !== JWT_PARTS) return null;
  const payloadStr = parts[1];
  if (payloadStr === undefined || payloadStr.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(payloadStr));
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

export const decodeAccessToken = (token: string): DecodedAccessToken => {
  const payload = extractPayload(token);
  if (payload === null) return { role: null, userId: null, expiresAt: null };
  return {
    role: asRole(payload["role"]),
    userId: asUserId(payload["sub"]),
    expiresAt: asExpiresAt(payload["exp"]),
  };
};
