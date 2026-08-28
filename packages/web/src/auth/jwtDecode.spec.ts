/**
 * Story 1.7 — JWT decoder.
 *
 * The decoder extracts `role`, `sub` (as `userId`), and `exp` from the
 * access token payload (base64url-decoded). The signature is NOT verified
 * client-side — the api's `authenticate` middleware does that on every
 * request.
 */
import { describe, expect, it } from "vitest";

import { decodeAccessToken } from "./jwtDecode";

const b64url = (input: string): string => {
  const base64 =
    typeof globalThis.btoa === "function"
      ? globalThis.btoa(input)
      : Buffer.from(input, "utf-8").toString("base64");
  return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};

const HEADER = { alg: "HS256", typ: "JWT" };

const mint = (payload: Record<string, unknown>): string =>
  `${b64url(JSON.stringify(HEADER))}.${b64url(JSON.stringify(payload))}.sig`;

describe("Story 1.7 — decodeAccessToken (JWT role claim)", () => {
  it("returns the role for an Admin token", () => {
    const token = mint({
      iss: "surakkha-api",
      aud: "user",
      sub: "00000000-0000-4000-8000-00000000a001",
      scope: "user:read",
      iat: 1,
      exp: 9999999999,
      role: "Admin",
    });
    expect(decodeAccessToken(token)).toEqual({
      role: "Admin",
      userId: "00000000-0000-4000-8000-00000000a001",
      expiresAt: 9999999999,
    });
  });

  it("returns the role for an Operator / Technician / Viewer token", () => {
    for (const role of ["Operator", "Technician", "Viewer"] as const) {
      const token = mint({ role, exp: 100 });
      expect(decodeAccessToken(token).role).toBe(role);
    }
  });

  it("returns role=null when the claim is absent (device / simulator token)", () => {
    const token = mint({
      iss: "surakkha-api",
      aud: "device",
      sub: "00000000-0000-4000-8000-00000000d001",
      scope: "telemetry:write",
      iat: 1,
      exp: 100,
    });
    expect(decodeAccessToken(token).role).toBeNull();
  });

  it("returns role=null for an unknown role value", () => {
    const token = mint({ role: "Ghost", exp: 100 });
    expect(decodeAccessToken(token).role).toBeNull();
  });

  it("returns nulls for a malformed token (not 3 parts)", () => {
    expect(decodeAccessToken("not.a.real.token.extra")).toEqual({
      role: null,
      userId: null,
      expiresAt: null,
    });
    expect(decodeAccessToken("only-one-part")).toEqual({
      role: null,
      userId: null,
      expiresAt: null,
    });
  });

  it("returns nulls for an unparseable payload", () => {
    const token = `aaa.!!!not-base64!!!.sig`;
    expect(decodeAccessToken(token)).toEqual({
      role: null,
      userId: null,
      expiresAt: null,
    });
  });
});

describe("Story 4.7 — decodeAccessToken (JWT sub claim → userId)", () => {
  it("returns the userId for a token with a string sub claim", () => {
    const token = mint({
      sub: "00000000-0000-4000-8000-00000000a003",
      role: "Technician",
      exp: 9999999999,
    });
    expect(decodeAccessToken(token).userId).toBe("00000000-0000-4000-8000-00000000a003");
  });

  it("returns userId=null when the sub claim is absent", () => {
    const token = mint({ role: "Operator", exp: 100 });
    expect(decodeAccessToken(token).userId).toBeNull();
  });

  it("returns userId=null when the sub claim is the empty string", () => {
    const token = mint({ sub: "", role: "Admin", exp: 100 });
    expect(decodeAccessToken(token).userId).toBeNull();
  });

  it("returns userId=null when the sub claim is a non-string type", () => {
    const token = mint({ sub: 42, role: "Admin", exp: 100 });
    expect(decodeAccessToken(token).userId).toBeNull();
  });
});
