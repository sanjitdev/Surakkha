/**
 * Seed tests — packages/db (Story 2.5).
 *
 * Pins the seed's `deriveName` and `assertValidScenario` helpers.
 * The full Prisma upsert flow is exercised in the docker-compose
 * stack's boot sequence; here we pin only the pure helpers so a
 * regression in label generation or scenario validation surfaces in CI
 * before the seed ever hits the DB.
 *
 * The seed script itself (`seed.ts`) is not importable in vitest
 * because it boots Prisma and calls `process.exit` at module load.
 * Pure helpers live in `seedHelpers.ts` and are tested here.
 */
import { describe, expect, it } from "vitest";

import { SCENARIO_NAMES } from "@surakkha/shared/simulator";

import { assertValidScenario, deriveName } from "./seedHelpers.js";

const SEED_DEVICE_IDS = [
  "9b1c4f00-0000-4000-8000-000000000001",
  "9b1c4f00-0000-4000-8000-000000000002",
  "9b1c4f00-0000-4000-8000-000000000003",
  "9b1c4f00-0000-4000-8000-000000000004",
  "9b1c4f00-0000-4000-8000-000000000005",
  "9b1c4f00-0000-4000-8000-000000000006",
] as const;

describe("deriveName (Story 2.5 — seed placeholder)", () => {
  it("uses the last 4 hex digits of a canonical UUIDv4 device_id", () => {
    expect(deriveName("9b1c4f00-0000-4000-8000-000000000001")).toBe(
      "DEVICE-0001",
    );
    expect(deriveName("9b1c4f00-0000-4000-8000-000000000006")).toBe(
      "DEVICE-0006",
    );
  });

  it("uppercases hex letters in the tail", () => {
    expect(deriveName("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(
      "DEVICE-EEEE",
    );
  });

  it("produces unique names for the six seeded UUIDs", () => {
    const names = SEED_DEVICE_IDS.map(deriveName);
    expect(new Set(names).size).toBe(SEED_DEVICE_IDS.length);
    expect(names).toEqual([
      "DEVICE-0001",
      "DEVICE-0002",
      "DEVICE-0003",
      "DEVICE-0004",
      "DEVICE-0005",
      "DEVICE-0006",
    ]);
  });

  it("rejects an empty string", () => {
    expect(() => deriveName("")).toThrow(
      /device_id must be a non-empty UUIDv4/,
    );
  });

  it("rejects a too-short id", () => {
    expect(() => deriveName("abc")).toThrow(/must be a valid UUIDv4/);
  });

  it("rejects a UUIDv4 with non-hex characters in the tail", () => {
    expect(() =>
      deriveName("9b1c4f00-0000-4000-8000-00000000000Z"),
    ).toThrow(/must be a valid UUIDv4/);
  });

  it("rejects a UUIDv1-shaped string (version digit must be 4)", () => {
    expect(() =>
      deriveName("9b1c4f00-0000-1000-8000-000000000001"),
    ).toThrow(/must be a valid UUIDv4/);
  });

  it("rejects a UUIDv4 with the wrong variant nibble", () => {
    expect(() =>
      deriveName("9b1c4f00-0000-4000-c000-000000000001"),
    ).toThrow(/must be a valid UUIDv4/);
  });
});

describe("assertValidScenario (Story 2.5 — scenario enum pin)", () => {
  it("accepts every documented scenario name", () => {
    for (const name of SCENARIO_NAMES) {
      expect(() => assertValidScenario(name)).not.toThrow();
    }
  });

  it("rejects an unknown scenario with a descriptive error", () => {
    expect(() => assertValidScenario("Bogus")).toThrow(
      /invalid scenario "Bogus"/,
    );
  });

  it("rejects an empty string", () => {
    expect(() => assertValidScenario("")).toThrow(/invalid scenario ""/);
  });

  it("rejects case variants (closed enum, not normalised)", () => {
    expect(() => assertValidScenario("normal")).toThrow(
      /invalid scenario "normal"/,
    );
  });
});