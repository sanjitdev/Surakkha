/**
 * Tests for `@surakkha/shared/auth` JWT-claim surface (Story 2.1).
 *
 * Four ACs pinned in the spec:
 *   1. Required-field presence (omit each of `iss` / `aud` / `sub` / `scope`
 *      one at a time → `JwtClaimsSchema.safeParse` fails).
 *   2. `aud` enum rejects `["admin", ""]`.
 *   3. `simulatorClaimTemplate` output re-parses through
 *      `JwtClaimsSchema.parse` and stamps the right `aud`/`scope`/TTL.
 *   4. `deviceClaimTemplate` output re-parses through
 *      `JwtClaimsSchema.parse` and stamps a 24h TTL.
 */
import { describe, expect, it } from "vitest";

import {
  type JwtClaims,
  JwtClaimsSchema,
  deviceClaimTemplate,
  simulatorClaimTemplate,
} from "../index.js";

const VALID_DEVICE_UUID = "9b1c4d2e-1234-4abc-9def-1234567890ab";

const makeBaseClaim = (): JwtClaims => {
  const iat = Math.floor(Date.now() / 1000);
  return {
    iss: "surakkha-api",
    aud: "simulator",
    sub: VALID_DEVICE_UUID,
    scope: "telemetry:write",
    iat,
    exp: iat + 3600,
  };
};

describe("JwtClaimsSchema required-field presence (AC2.1)", () => {
  it("rejects when each of `iss`, `aud`, `sub`, `scope` is omitted", () => {
    const fields: Array<keyof JwtClaims> = ["iss", "aud", "sub", "scope"];
    for (const field of fields) {
      const claim = makeBaseClaim();
      const partial: Record<string, unknown> = { ...claim };
      delete partial[field];
      expect(JwtClaimsSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("JwtClaimsSchema `aud` enum (AC2.2)", () => {
  it("rejects `aud: 'admin'` and `aud: ''`", () => {
    const base = makeBaseClaim();
    const adminResult = JwtClaimsSchema.safeParse({
      ...base,
      aud: "admin" as unknown as JwtClaims["aud"],
    });
    expect(adminResult.success).toBe(false);

    const emptyResult = JwtClaimsSchema.safeParse({
      ...base,
      aud: "" as unknown as JwtClaims["aud"],
    });
    expect(emptyResult.success).toBe(false);
  });
});

describe("simulatorClaimTemplate factory (AC2.3)", () => {
  it("re-parses cleanly and stamps aud=simulator, scope=telemetry:write, exp-iat===3600", () => {
    const claim = simulatorClaimTemplate(VALID_DEVICE_UUID);
    const reparsed = JwtClaimsSchema.parse(claim);
    expect(reparsed.aud).toBe("simulator");
    expect(reparsed.scope).toBe("telemetry:write");
    expect(reparsed.exp - reparsed.iat).toBe(3600);
    expect(reparsed.sub).toBe(VALID_DEVICE_UUID);
    expect(reparsed.iss).toBe("surakkha-api");
  });
});

describe("deviceClaimTemplate factory (AC2.4)", () => {
  it("re-parses cleanly and stamps aud=device, scope=telemetry:write, exp-iat===86400", () => {
    const claim = deviceClaimTemplate(VALID_DEVICE_UUID);
    const reparsed = JwtClaimsSchema.parse(claim);
    expect(reparsed.aud).toBe("device");
    expect(reparsed.scope).toBe("telemetry:write");
    expect(reparsed.exp - reparsed.iat).toBe(86400);
    expect(reparsed.sub).toBe(VALID_DEVICE_UUID);
    expect(reparsed.iss).toBe("surakkha-api");
  });
});

describe("simulatorClaimTemplate / deviceClaimTemplate reject non-UUIDv4 subs", () => {
  it.each([
    ["simulatorClaimTemplate", simulatorClaimTemplate],
    ["deviceClaimTemplate", deviceClaimTemplate],
  ] as const)("%s throws on non-UUIDv4 sub", (_name, factory) => {
    expect(() => factory("not-a-uuid")).toThrow(/UUIDv4/);
    expect(() => factory("9b1c4d2e-1234-1234-1234-1234567890ab")).toThrow(/UUIDv4/); // v1 hex nibble
  });
});