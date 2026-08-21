/**
 * Story 1.4 — JWT issuance + verification.
 *
 * Covers:
 *   - assertJwtSecret() exits with code 1 when JWT_SECRET is missing/weak
 *   - issueAccessToken() signs an HS256 token with iss/aud/exp = 8h
 *   - verifyAccessToken() decodes a fresh token; rejects a tampered one
 *   - refresh token round-trip: issue, verify, extract sub
 *   - tampered refresh token returns null
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertJwtSecret,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./jwt";

const STRONG_SECRET = "x".repeat(64);

const setSecret = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env["JWT_SECRET"];
  } else {
    process.env["JWT_SECRET"] = value;
  }
};

const restore = (original: string | undefined) => {
  setSecret(original);
};

describe("Story 1.4 — JWT_SECRET fail-fast", () => {
  const original = process.env["JWT_SECRET"];
  afterEach(() => restore(original));

  it("calls process.exit(1) when JWT_SECRET is missing", () => {
    setSecret(undefined);
    const spy = vi.spyOn(process, "exit").mockImplementation(((
      _code?: number | string | null,
    ) => undefined) as never);
    try {
      assertJwtSecret();
      expect(spy).toHaveBeenCalledWith(1);
    } finally {
      spy.mockRestore();
      setSecret(STRONG_SECRET);
    }
  });

  it("calls process.exit(1) when JWT_SECRET is shorter than 32 chars", () => {
    setSecret("tooshort");
    const spy = vi.spyOn(process, "exit").mockImplementation(((
      _code?: number | string | null,
    ) => undefined) as never);
    try {
      assertJwtSecret();
      expect(spy).toHaveBeenCalledWith(1);
    } finally {
      spy.mockRestore();
      setSecret(STRONG_SECRET);
    }
  });

  it("returns the secret when valid", () => {
    setSecret(STRONG_SECRET);
    expect(assertJwtSecret()).toBe(STRONG_SECRET);
  });
});

describe("Story 1.4 — access token", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => restore(original));

  it("signs an HS256 token with iss=surakkha-api, aud=user, 8h TTL", () => {
    const { token, expiresIn } = issueAccessToken({
      userId: "00000000-0000-4000-8000-00000000a001",
    });
    expect(token.split(".")).toHaveLength(3);
    expect(expiresIn).toBe(28800);

    const decoded = verifyAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.iss).toBe("surakkha-api");
    expect(decoded?.aud).toBe("user");
    expect(decoded?.sub).toBe("00000000-0000-4000-8000-00000000a001");
    expect(decoded?.scope).toBe("user:read");
    expect(decoded?.exp - (decoded?.iat ?? 0)).toBe(28800);
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = issueAccessToken({
      userId: "00000000-0000-4000-8000-00000000a001",
    });
    setSecret("a-different-secret-that-is-also-thirty-two-chars-long");
    expect(verifyAccessToken(token)).toBeNull();
  });

  it("Story 1.7: embeds the role claim when provided", () => {
    const { token } = issueAccessToken({
      userId: "00000000-0000-4000-8000-00000000a002",
      role: "Operator",
    });
    const decoded = verifyAccessToken(token);
    expect(decoded?.role).toBe("Operator");
  });

  it("Story 1.7: omits the role claim when not provided (device / simulator tokens)", () => {
    const { token } = issueAccessToken({
      userId: "00000000-0000-4000-8000-00000000d001",
      audience: "device",
      scope: "telemetry:write",
    });
    const decoded = verifyAccessToken(token);
    expect(decoded?.role).toBeUndefined();
  });
});

describe("Story 1.4 — refresh token", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => restore(original));

  it("round-trips the userId", () => {
    const refresh = issueRefreshToken("00000000-0000-4000-8000-00000000a002");
    const verified = verifyRefreshToken(refresh);
    expect(verified).toEqual({ userId: "00000000-0000-4000-8000-00000000a002" });
  });

  it("rejects a tampered refresh token", () => {
    const refresh = issueRefreshToken("00000000-0000-4000-8000-00000000a002");
    const tampered = `${refresh.slice(0, -3)  }AAA`;
    expect(verifyRefreshToken(tampered)).toBeNull();
  });

  it("rejects an access token when used as a refresh token", () => {
    const { token } = issueAccessToken({
      userId: "00000000-0000-4000-8000-00000000a003",
    });
    expect(verifyRefreshToken(token)).toBeNull();
  });
});