/**
 * Story 2.4 — `jwt.ts` unit tests.
 *
 * Covers the loopback-1 gap: `boot.spec.ts` asserts `sign` is called
 * six times but never inspects the claim shape; these tests pin the
 * claim shape directly against the round-tripped token. Also pins
 * the typed reason strings from `resolveJwtSecret` so a regression
 * that returns a wrong reason (e.g. "undefined" instead of "missing")
 * is caught.
 *
 * Run with `pnpm --filter @surakkha/simulator test`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JWT_SECRET_MIN_LENGTH } from "@surakkha/shared/auth";

import {
  assertJwtSecretOrExit,
  mintSimulatorToken,
  mintSimulatorTokensForDevices,
  resolveJwtSecret,
} from "../jwt.js";

const DEVICE_UUID = "9b1c4f00-0000-4000-8000-000000000001";

const setSecret = (value: string | undefined): void => {
  if (value === undefined) {
    delete process.env["JWT_SECRET"];
  } else {
    process.env["JWT_SECRET"] = value;
  }
};

const restoreSecret = (previous: string | undefined): void => {
  setSecret(previous);
};

describe("resolveJwtSecret", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env["JWT_SECRET"];
  });
  afterEach(() => {
    restoreSecret(previous);
  });

  it("returns ok:true with the secret string when JWT_SECRET is set and >= min length", () => {
    const secret = "x".repeat(JWT_SECRET_MIN_LENGTH);
    setSecret(secret);
    const result = resolveJwtSecret();
    expect(result).toEqual({ ok: true, secret });
  });

  it("returns ok:false reason:'missing' when JWT_SECRET is unset", () => {
    setSecret(undefined);
    const result = resolveJwtSecret();
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("returns ok:false reason:'missing' when JWT_SECRET is the empty string", () => {
    setSecret("");
    const result = resolveJwtSecret();
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("returns ok:false reason:'too_short' when JWT_SECRET is below the min length", () => {
    setSecret("x".repeat(JWT_SECRET_MIN_LENGTH - 1));
    const result = resolveJwtSecret();
    expect(result).toEqual({ ok: false, reason: "too_short" });
  });

  it("accepts a secret of exactly JWT_SECRET_MIN_LENGTH characters", () => {
    setSecret("x".repeat(JWT_SECRET_MIN_LENGTH));
    const result = resolveJwtSecret();
    expect(result.ok).toBe(true);
  });
});

describe("assertJwtSecretOrExit", () => {
  let previous: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    previous = process.env["JWT_SECRET"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with ${code ?? "undefined"}`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    restoreSecret(previous);
  });

  it("returns the secret string on success", () => {
    const secret = "x".repeat(JWT_SECRET_MIN_LENGTH);
    setSecret(secret);
    expect(assertJwtSecretOrExit()).toBe(secret);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits with code 1 when JWT_SECRET is missing", () => {
    setSecret(undefined);
    expect(() => assertJwtSecretOrExit()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits with code 1 when JWT_SECRET is too short", () => {
    setSecret("short");
    expect(() => assertJwtSecretOrExit()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("mintSimulatorToken", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env["JWT_SECRET"];
    setSecret("x".repeat(JWT_SECRET_MIN_LENGTH));
  });
  afterEach(() => {
    restoreSecret(previous);
  });

  it("produces a JWT whose decoded claims match simulatorClaimTemplate", async () => {
    const token = mintSimulatorToken(DEVICE_UUID);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
    const jwtModule = await import("jsonwebtoken");
    const decoded = jwtModule.default.verify(token, process.env["JWT_SECRET"] as string, {
      algorithms: ["HS256"],
    }) as Record<string, unknown>;
    expect(decoded["iss"]).toBe("surakkha-api");
    expect(decoded["aud"]).toBe("simulator");
    expect(decoded["scope"]).toBe("telemetry:write");
    expect(decoded["sub"]).toBe(DEVICE_UUID);
    expect(typeof decoded["iat"]).toBe("number");
    expect(typeof decoded["exp"]).toBe("number");
  });

  it("stamps iat=now and exp=iat+TTL (1h per SIMULATOR_TOKEN_TTL_SECONDS)", () => {
    const token = mintSimulatorToken(DEVICE_UUID);
    const decoded = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    ) as Record<string, unknown>;
    const iat = decoded["iat"] as number;
    const exp = decoded["exp"] as number;
    expect(exp - iat).toBe(3_600);
  });

  it("throws when JWT_SECRET is missing", () => {
    setSecret(undefined);
    expect(() => mintSimulatorToken(DEVICE_UUID)).toThrow(/JWT_SECRET missing/);
  });

  it("throws when JWT_SECRET is too short", () => {
    setSecret("short");
    expect(() => mintSimulatorToken(DEVICE_UUID)).toThrow(/JWT_SECRET too_short/);
  });
});

describe("mintSimulatorTokensForDevices", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env["JWT_SECRET"];
    setSecret("x".repeat(JWT_SECRET_MIN_LENGTH));
  });
  afterEach(() => {
    restoreSecret(previous);
  });

  it("mints one token per device, six total for six devices", () => {
    const ids = [
      "9b1c4f00-0000-4000-8000-000000000001",
      "9b1c4f00-0000-4000-8000-000000000002",
      "9b1c4f00-0000-4000-8000-000000000003",
      "9b1c4f00-0000-4000-8000-000000000004",
      "9b1c4f00-0000-4000-8000-000000000005",
      "9b1c4f00-0000-4000-8000-000000000006",
    ];
    const tokens = mintSimulatorTokensForDevices(ids);
    expect(tokens.size).toBe(6);
    for (const id of ids) {
      const token = tokens.get(id);
      expect(typeof token).toBe("string");
      expect(token).not.toBe("");
    }
    // All tokens are distinct (different `sub` round-trips through
    // `simulatorClaimTemplate` which adds `iat`, so two tokens for
    // the same sub minted at the same instant may collide — using
    // distinct ids gives a strong pin).
    const tokenList = [...tokens.values()];
    expect(new Set(tokenList).size).toBe(6);
  });

  it("collapses duplicate deviceIds into one entry (defensive)", () => {
    const tokens = mintSimulatorTokensForDevices([DEVICE_UUID, DEVICE_UUID]);
    expect(tokens.size).toBe(1);
  });
});