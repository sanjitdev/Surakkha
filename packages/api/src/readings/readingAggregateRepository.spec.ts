/**
 * `readingAggregateRepository.spec.ts` — Story 5.4.
 *
 * Unit tests for the Prisma `where`-clause helpers and the
 * `clampLimit` caller-side guard. Mirrors the
 * `auditLogRepository.spec.ts:1-29` preamble style. The (future)
 * admin read surface's integration suite will stub
 * `findMany` entirely; the helper chain never executes, so a
 * regression in `deviceWhere` / `metricWhere` / `dateRangeWhere`
 * / `toPrismaWhere` / `clampLimit` would pass the integration
 * spec without exercising the actual mapping.
 *
 * Why unit tests at the helper seam (vs at the repo seam):
 *
 *   - The future router-level integration spec stubs `findMany`
 *     entirely; the helper chain never executes, so a regression
 *     here surfaces as silently dropped filters (admin sees more
 *     rows than the chip row implies) or 500s on Prisma throws.
 *
 *   - These helpers are the boundary between the api's filter
 *     vocabulary and Prisma's `where` vocabulary. A regression
 *     here is a wire-contract drift.
 *
 * Each helper is called directly; the test pins the exact object
 * literal the helper must return. The `Date` values in the
 * date-range cases are passed as-is so the assertion uses
 * `toBe` (identity compare) rather than `toEqual`.
 */
import { describe, expect, it } from "vitest";

import {
  type ReadingAggregateFilters,
  clampLimit,
  dateRangeWhere,
  deviceWhere,
  metricWhere,
  toPrismaWhere,
} from "./readingAggregateRepository.js";

const DEVICE_A = "00000000-0000-4000-8000-00000000000a";
const SINCE = new Date("2026-08-25T00:00:00.000Z");
const UNTIL = new Date("2026-08-26T00:00:00.000Z");

describe("Story 5.4 — readingAggregateRepository where helpers", () => {
  describe("deviceWhere", () => {
    it("returns null when deviceId is undefined (no filter applied)", () => {
      const filters: ReadingAggregateFilters = {};
      expect(deviceWhere(filters)).toBeNull();
    });

    it("returns null when deviceId is the empty string (no filter applied)", () => {
      const filters: ReadingAggregateFilters = { deviceId: "" };
      expect(deviceWhere(filters)).toBeNull();
    });

    it("returns { deviceId: { equals: ... } } for a single UUID", () => {
      const filters: ReadingAggregateFilters = { deviceId: DEVICE_A };
      expect(deviceWhere(filters)).toEqual({ deviceId: { equals: DEVICE_A } });
    });
  });

  describe("metricWhere", () => {
    it("returns null when metric is undefined (no filter applied)", () => {
      const filters: ReadingAggregateFilters = {};
      expect(metricWhere(filters)).toBeNull();
    });

    it("returns null when metric is the empty string (no filter applied)", () => {
      const filters: ReadingAggregateFilters = { metric: "" };
      expect(metricWhere(filters)).toBeNull();
    });

    it("returns { metric: { equals: ... } } for a closed-enum value", () => {
      const filters: ReadingAggregateFilters = { metric: "tds" };
      expect(metricWhere(filters)).toEqual({ metric: { equals: "tds" } });
    });

    it("accepts each of the six closed-enum members verbatim", () => {
      // Pin the closed-enum vocabulary at the helper seam so a
      // future addition to `@surakkha/shared/reading-aggregate`
      // surfaces here as a missing test case rather than a silent
      // drift. The router validates against the Zod schema
      // before forwarding, so this helper trusts the input.
      const metrics = ["tds", "turbidity", "ph", "temperature", "battery", "signal"] as const;
      for (const m of metrics) {
        expect(metricWhere({ metric: m })).toEqual({ metric: { equals: m } });
      }
    });
  });

  describe("dateRangeWhere", () => {
    it("returns null when neither since nor until is set", () => {
      const filters: ReadingAggregateFilters = {};
      expect(dateRangeWhere(filters)).toBeNull();
    });

    it("returns { bucketStart: { gte } } when only since is set", () => {
      const filters: ReadingAggregateFilters = { since: SINCE };
      expect(dateRangeWhere(filters)).toEqual({ bucketStart: { gte: SINCE } });
    });

    it("returns { bucketStart: { lt } } when only until is set", () => {
      const filters: ReadingAggregateFilters = { until: UNTIL };
      expect(dateRangeWhere(filters)).toEqual({ bucketStart: { lt: UNTIL } });
    });

    it("returns { bucketStart: { gte, lt } } when both since and until are set", () => {
      const filters: ReadingAggregateFilters = { since: SINCE, until: UNTIL };
      expect(dateRangeWhere(filters)).toEqual({
        bucketStart: { gte: SINCE, lt: UNTIL },
      });
    });
  });

  describe("toPrismaWhere", () => {
    it("returns an empty object when no filters are set (unfiltered listing)", () => {
      const filters: ReadingAggregateFilters = {};
      expect(toPrismaWhere(filters)).toEqual({});
    });

    it("AND-s every filter into a single where clause", () => {
      const filters: ReadingAggregateFilters = {
        deviceId: DEVICE_A,
        metric: "tds",
        since: SINCE,
        until: UNTIL,
      };
      expect(toPrismaWhere(filters)).toEqual({
        deviceId: { equals: DEVICE_A },
        metric: { equals: "tds" },
        bucketStart: { gte: SINCE, lt: UNTIL },
      });
    });

    it("omits a key entirely when the corresponding helper returns null", () => {
      // `deviceId` is "" → no `deviceId` key.
      // `metric` is undefined → no `metric` key.
      // `since` is set → `bucketStart` key present.
      const filters: ReadingAggregateFilters = { deviceId: "", since: SINCE };
      const where = toPrismaWhere(filters);
      expect(where).toEqual({ bucketStart: { gte: SINCE } });
      expect("deviceId" in where).toBe(false);
      expect("metric" in where).toBe(false);
    });
  });

  describe("clampLimit", () => {
    it("returns DEFAULT_LIMIT (100) when limit is undefined", () => {
      expect(clampLimit(undefined)).toEqual({ take: 100, shortCircuit: false });
    });

    it("returns DEFAULT_LIMIT (100) when limit is null", () => {
      expect(clampLimit(null)).toEqual({ take: 100, shortCircuit: false });
    });

    it("short-circuits with take: 0 when limit is 0", () => {
      // The spec's REPO_FIND_INVALID_LIMIT case: limit < 1 must
      // return an empty result without hitting Prisma.
      expect(clampLimit(0)).toEqual({ take: 0, shortCircuit: true });
    });

    it("short-circuits with take: 0 when limit is negative", () => {
      expect(clampLimit(-5)).toEqual({ take: 0, shortCircuit: true });
    });

    it("short-circuits with take: 0 when limit is NaN", () => {
      expect(clampLimit(Number.NaN)).toEqual({ take: 0, shortCircuit: true });
    });

    it("passes through a positive limit below the cap", () => {
      expect(clampLimit(50)).toEqual({ take: 50, shortCircuit: false });
    });

    it("clamps a limit above MAX_LIMIT (1000) down to the cap", () => {
      expect(clampLimit(10_000)).toEqual({ take: 1_000, shortCircuit: false });
    });

    it("floors a fractional limit", () => {
      // Defensive — a caller that forwards `parseFloat(query.limit)`
      // without an integer cast should not get a half-row page.
      expect(clampLimit(50.7)).toEqual({ take: 50, shortCircuit: false });
    });
  });
});
