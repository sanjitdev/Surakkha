/**
 * Story 2.2 — `verifyIngestClaims` (claim-driven verifier for the WS
 * ingest endpoint).
 *
 * Covers the six required cases:
 *   1. valid device token (aud=device, sub matches URL)
 *   2. valid simulator token (aud=simulator, sub matches URL)
 *   3. sub mismatch (aud correct, sub does not match URL)
 *   4. aud=user rejection (audience not in {device, simulator})
 *   5. scope mismatch (right audience, wrong scope)
 *   6. signature failure (token signed with a different secret)
 *
 * The pattern mirrors `jwt.spec.ts` — set JWT_SECRET per test, use
 * `vi.spyOn(process, "exit")` if needed, restore at the end.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";

import { verifyIngestClaims } from "./jwt";

const STRONG_SECRET = "x".repeat(64);
const OTHER_SECRET = "y".repeat(64);

const DEVICE_UUID = "9b1c4f00-1234-4abc-9def-0123456789ab";
const OTHER_UUID = "9b1c4f00-1234-4abc-9def-0123456789cd";

const setSecret = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env["JWT_SECRET"];
  } else {
    process.env["JWT_SECRET"] = value;
  }
};

const sign = (
  payload: Record<string, unknown>,
  secret: string = STRONG_SECRET,
): string =>
  jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: 3600,
  });

let originalSecret: string | undefined;

describe("Story 2.2 — verifyIngestClaims", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  it("accepts a valid device token whose sub matches the URL device_id", () => {
    const token = sign({
      iss: "surakkha-api",
      aud: "device",
      sub: DEVICE_UUID,
      scope: "telemetry:write",
    });
    const claims = verifyIngestClaims(token, DEVICE_UUID);
    expect(claims).not.toBeNull();
    expect(claims?.aud).toBe("device");
    expect(claims?.sub).toBe(DEVICE_UUID);
    expect(claims?.scope).toBe("telemetry:write");
  });

  it("accepts a valid simulator token whose sub matches the URL device_id", () => {
    const token = sign({
      iss: "surakkha-api",
      aud: "simulator",
      sub: DEVICE_UUID,
      scope: "telemetry:write",
    });
    const claims = verifyIngestClaims(token, DEVICE_UUID);
    expect(claims).not.toBeNull();
    expect(claims?.aud).toBe("simulator");
  });

  it("rejects when the JWT sub does not match the URL device_id", () => {
    const token = sign({
      iss: "surakkha-api",
      aud: "device",
      sub: OTHER_UUID,
      scope: "telemetry:write",
    });
    expect(verifyIngestClaims(token, DEVICE_UUID)).toBeNull();
  });

  it("rejects a user-audience token (aud=user is not an ingest audience)", () => {
    const token = sign({
      iss: "surakkha-api",
      aud: "user",
      sub: DEVICE_UUID,
      scope: "user:read",
    });
    expect(verifyIngestClaims(token, DEVICE_UUID)).toBeNull();
  });

  it("rejects when the scope is not telemetry:write", () => {
    const token = sign({
      iss: "surakkha-api",
      aud: "device",
      sub: DEVICE_UUID,
      scope: "user:read",
    });
    expect(verifyIngestClaims(token, DEVICE_UUID)).toBeNull();
  });

  it("returns null on a token signed with a different secret", () => {
    const token = sign(
      {
        iss: "surakkha-api",
        aud: "device",
        sub: DEVICE_UUID,
        scope: "telemetry:write",
      },
      OTHER_SECRET,
    );
    expect(verifyIngestClaims(token, DEVICE_UUID)).toBeNull();
  });

  it("rejects a token whose iss is not surakkha-api", () => {
    const token = jwt.sign(
      {
        iss: "other-issuer",
        aud: "device",
        sub: DEVICE_UUID,
        scope: "telemetry:write",
      },
      STRONG_SECRET,
      { algorithm: "HS256", expiresIn: 3600 },
    );
    expect(verifyIngestClaims(token, DEVICE_UUID)).toBeNull();
  });

  it("accepts a token whose exp is 25 seconds in the past (within 30s clock-skew tolerance) and rejects a 60s-stale token", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const withinSkew = jwt.sign(
      {
        iss: "surakkha-api",
        aud: "device",
        sub: DEVICE_UUID,
        scope: "telemetry:write",
        exp: nowSec - 25,
      },
      STRONG_SECRET,
      { algorithm: "HS256" },
    );
    const beyondSkew = jwt.sign(
      {
        iss: "surakkha-api",
        aud: "device",
        sub: DEVICE_UUID,
        scope: "telemetry:write",
        exp: nowSec - 60,
      },
      STRONG_SECRET,
      { algorithm: "HS256" },
    );
    expect(verifyIngestClaims(withinSkew, DEVICE_UUID)).not.toBeNull();
    expect(verifyIngestClaims(beyondSkew, DEVICE_UUID)).toBeNull();
  });
});