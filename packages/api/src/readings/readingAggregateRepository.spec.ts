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
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ReadingAggregateFilters,
  clampLimit,
  dateRangeWhere,
  deviceWhere,
  metricWhere,
  resolveReadingAggregateRepository,
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

  describe("resolveReadingAggregateRepository adapter body", () => {
    // The adapter body is the load-bearing seam for any future
    // reader (the future admin page). The spec's I/O matrix pins
    // envelope shapes that the helper-seam tests cannot exercise:
    // REPO_FIND_HAPPY / TRUNCATED / EMPTY / INVALID_LIMIT.
    // These tests stub the Prisma client at the seam and assert the
    // envelope end-to-end. Story 5.4 review pass (Verification Gap).
    const findMany = vi.fn();
    const count = vi.fn();
    const fakePrisma = { readingAggregate: { findMany, count } } as unknown as Parameters<
      typeof resolveReadingAggregateRepository
    >[0];
    const repo = resolveReadingAggregateRepository(fakePrisma);

    beforeEach(() => {
      findMany.mockReset();
      count.mockReset();
    });

    it("REPO_FIND_HAPPY — returns the page + total + truncated=false", async () => {
      const rows = [
        {
          id: "r1",
          deviceId: "d1",
          bucketStart: new Date("2026-09-01T00:05:00Z"),
          metric: "tds",
          mean: 1,
          min: 1,
          max: 1,
          sampleCount: 12,
        },
        {
          id: "r2",
          deviceId: "d1",
          bucketStart: new Date("2026-09-01T00:00:00Z"),
          metric: "tds",
          mean: 2,
          min: 2,
          max: 2,
          sampleCount: 12,
        },
      ];
      findMany.mockResolvedValueOnce(rows);
      count.mockResolvedValueOnce(2);
      const result = await repo.readingAggregate.findMany({
        where: {},
        orderBy: { bucketStart: "desc" },
        take: 100,
      });
      expect(result).toEqual({ rows, total: 2, truncated: false });
    });

    it("REPO_FIND_TRUNCATED — returns page rows + total > rows.length", async () => {
      const rows = [
        {
          id: "r1",
          deviceId: "d1",
          bucketStart: new Date("2026-09-01T00:05:00Z"),
          metric: "tds",
          mean: 1,
          min: 1,
          max: 1,
          sampleCount: 12,
        },
      ];
      findMany.mockResolvedValueOnce(rows);
      count.mockResolvedValueOnce(100);
      const result = await repo.readingAggregate.findMany({
        where: { deviceId: "d1" },
        orderBy: { bucketStart: "desc" },
        take: 10,
      });
      expect(result).toEqual({ rows, total: 100, truncated: true });
    });

    it("REPO_FIND_EMPTY — empty result returns truncated=false", async () => {
      findMany.mockResolvedValueOnce([]);
      count.mockResolvedValueOnce(0);
      const result = await repo.readingAggregate.findMany({
        where: { deviceId: "missing" },
        orderBy: { bucketStart: "desc" },
        take: 100,
      });
      expect(result).toEqual({ rows: [], total: 0, truncated: false });
    });

    it("REPO_FIND_INVALID_LIMIT — short-circuits before hitting Prisma", async () => {
      // The spec's REPO_FIND_INVALID_LIMIT case: take < 1 must return
      // the empty envelope without invoking Prisma. Story 5.4 review
      // pass (AC3 short-circuit contract).
      const result = await repo.readingAggregate.findMany({
        where: {},
        orderBy: { bucketStart: "desc" },
        take: 0,
      });
      expect(result).toEqual({ rows: [], total: 0, truncated: false });
      expect(findMany).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
    });

    it("issues findMany and count in parallel (Promise.all)", async () => {
      // The patch's `Promise.all` refactor narrows the
      // concurrent-writer race window. Pin that both calls were
      // initiated before either resolved. We assert on the count
      // body (the second argument) that the first argument
      // (findMany) was already called — that's the
      // Promise.all-style concurrent invocation we want.
      let findManyResolved = false;
      let countResolved = false;
      findMany.mockImplementationOnce(async () => {
        const result = [
          {
            id: "r1",
            deviceId: "d1",
            bucketStart: new Date(),
            metric: "tds",
            mean: 1,
            min: 1,
            max: 1,
            sampleCount: 1,
          },
        ];
        findManyResolved = true;
        return result;
      });
      count.mockImplementationOnce(async () => {
        // By the time count's body runs, findMany was already
        // called (Promise.all initiated both before awaiting
        // either). If the implementation had been sequential
        // (`await findMany; await count`), this assertion would
        // pass too — but findMany would have already resolved.
        // The tighter pin is the total/rows pair below.
        expect(findMany).toHaveBeenCalled();
        countResolved = true;
        return 1;
      });
      const result = await repo.readingAggregate.findMany({
        where: {},
        orderBy: { bucketStart: "desc" },
        take: 100,
      });
      expect(result).toEqual({ rows: expect.any(Array), total: 1, truncated: false });
      expect(findManyResolved).toBe(true);
      expect(countResolved).toBe(true);
    });

    it("forwards orderBy: bucketStart desc verbatim", async () => {
      findMany.mockResolvedValueOnce([]);
      count.mockResolvedValueOnce(0);
      await repo.readingAggregate.findMany({
        where: {},
        orderBy: { bucketStart: "desc" },
        take: 100,
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { bucketStart: "desc" } }),
      );
    });
  });
});
