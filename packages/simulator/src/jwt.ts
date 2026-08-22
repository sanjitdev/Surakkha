/**
 * Simulator JWT minting — Story 2.4.
 *
 * The simulator mints one fresh `aud:"simulator"` JWT per device at boot
 * (architecture §3.4, I-3, I-4). The claim template comes from
 * `simulatorClaimTemplate(deviceId)` in `@surakkha/shared/auth` so the
 * shared package's UUIDv4 invariant is not duplicated at the call site.
 *
 * `resolveJwtSecret` returns either the secret string or a typed reason
 * describing why the simulator cannot boot. `assertJwtSecretOrExit`
 * consumes that reason and exits with code 1 — the same fail-fast
 * pattern the api uses in `packages/api/src/auth/jwt.ts`.
 *
 * IMPORTANT: `mintSimulatorToken` reads `JWT_SECRET` lazily via
 * `resolveJwtSecret()` at every call. Tests that mutate `process.env`
 * between calls therefore see the new value. This matches the api's
 * `getSecret()` pattern (Story 1.4).
 */
import {
  JWT_SECRET_MIN_LENGTH,
  simulatorClaimTemplate,
} from "@surakkha/shared/auth";
import jwt from "jsonwebtoken";

export interface JwtSecretOk {
  readonly ok: true;
  readonly secret: string;
}
export interface JwtSecretFail {
  readonly ok: false;
  readonly reason: "missing" | "too_short";
}
export type JwtSecretResult = JwtSecretOk | JwtSecretFail;

/**
 * Read `JWT_SECRET` from `process.env` and validate it against
 * `JWT_SECRET_MIN_LENGTH`. Never throws — callers branch on the
 * discriminated union so a test can assert the exact reason string.
 */
export const resolveJwtSecret = (): JwtSecretResult => {
  const secret = process.env["JWT_SECRET"];
  if (secret === undefined || secret === "") {
    return { ok: false, reason: "missing" };
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  return { ok: true, secret };
};

/**
 * Fail-fast helper for boot-time validation. Logs the reason and
 * exits with code 1 on failure. On success returns the secret string
 * so the caller can pass it to the next step.
 *
 * We use `process.exit(1)` directly (the eslint rule against
 * `process.exit` is for graceful-shutdown paths; here we want a hard
 * exit before any socket is bound — same pattern as the api's
 * `assertJwtSecret`).
 */
export const assertJwtSecretOrExit = (): string => {
  const result = resolveJwtSecret();
  if (!result.ok) {
    const message =
      result.reason === "missing"
        ? "JWT_SECRET is not set; the simulator refuses to start without it."
        : `JWT_SECRET is too short; must be at least ${JWT_SECRET_MIN_LENGTH} characters (got ${process.env["JWT_SECRET"]?.length ?? 0}).`;
    console.error(`simulator: ${message}`);
    // eslint-disable-next-line no-restricted-properties
    process.exit(1);
  }
  return result.secret;
};

/**
 * Mint a single simulator JWT for a device UUID. Reads `JWT_SECRET`
 * via `resolveJwtSecret` so a test can mutate env between calls.
 *
 * The claim template (`simulatorClaimTemplate`) already stamps
 * `iat = now` and `exp = iat + SIMULATOR_TOKEN_TTL_SECONDS`
 * (architecture §3.4 → SIMULATOR_TOKEN_TTL_SECONDS = 3600). We rely
 * on `jsonwebtoken@9`'s default behaviour: if `iat` is already in
 * the payload it is preserved; `exp` is also a registered claim so
 * we pass `noTimestamp: false` (the default) and let the library
 * honour the values the shared template pinned. `noTimestamp: true`
 * would strip both `iat` AND the `exp` registered claim, which is
 * what we want to avoid.
 */
export const mintSimulatorToken = (deviceId: string): string => {
  const secretResult = resolveJwtSecret();
  if (!secretResult.ok) {
    throw new Error(
      `simulator: cannot mint token — JWT_SECRET ${secretResult.reason}`,
    );
  }
  const claims = simulatorClaimTemplate(deviceId);
  // Spread to a fresh object so `jsonwebtoken`'s in-place mutations
  // don't disturb the shared template's frozen claim.
  return jwt.sign(
    { ...claims },
    secretResult.secret,
    { algorithm: "HS256" },
  );
};

/**
 * Mint one simulator JWT per device. Returns a `Map<deviceId, token>`
 * for fast lookup at boot; the simulator's `index.ts` then opens one
 * Socket.IO connection per entry.
 *
 * Devices with duplicate UUIDs collapse to one entry — the upstream
 * `loadDevicesFile` validation already rejects duplicates, so this
 * collapse is purely defensive.
 */
export const mintSimulatorTokensForDevices = (
  deviceIds: readonly string[],
): ReadonlyMap<string, string> => {
  const tokens = new Map<string, string>();
  for (const id of deviceIds) {
    if (!tokens.has(id)) {
      tokens.set(id, mintSimulatorToken(id));
    }
  }
  return tokens;
};