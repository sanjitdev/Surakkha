/**
 * `auditLogRepository.spec.ts` — Story 5.3.
 *
 * Unit tests for the Prisma `where`-clause helpers. The
 * `audit/router.spec.ts` integration suite covers the
 * `findManyAuditLog` end-to-end path via a stub repo, but it
 * never exercises the `where` mapping itself — it mocks the
 * repo and the helpers never run. This spec is the seam where
 * the helper shape is pinned.
 *
 * Why unit tests at the helper seam (vs at the repo seam):
 *
 *   - The router-level integration spec stubs `findManyAuditLog`
 *     entirely; the helper chain never executes, so a regression
 *     in `actorWhere` / `eventWhere` / `resourceWhere` /
 *     `dateRangeWhere` / `toPrismaWhere` would pass the
 *     integration spec without exercising the actual mapping.
 *
 *   - These helpers are the boundary between the api's filter
 *     vocabulary and Prisma's `where` vocabulary. A regression
 *     here surfaces as silently dropped filters (admin sees
 *     more rows than the chip row implies) or 500s on Prisma
 *     throws.
 *
 * Each helper is called directly; the test pins the exact
 * object literal the helper must return. The `Date` values in
 * the date-range cases are passed as-is so the assertion uses
 * `toBe` (identity compare) rather than `toEqual`.
 */
import { describe, expect, it } from "vitest";

import {
  type AuditLogFilters,
  actorWhere,
  dateRangeWhere,
  eventWhere,
  resourceWhere,
  toPrismaWhere,
} from "./auditLogRepository.js";

const ACTOR_A = "00000000-0000-4000-8000-00000000000a";
const ACTOR_B = "00000000-0000-4000-8000-00000000000b";
const SINCE = new Date("2026-08-29T00:00:00.000Z");
const UNTIL = new Date("2026-08-30T00:00:00.000Z");

describe("Story 5.3 — auditLogRepository where helpers", () => {
  describe("actorWhere", () => {
    it("returns null when actorIds is undefined (no filter applied)", () => {
      const filters: AuditLogFilters = {};
      expect(actorWhere(filters)).toBeNull();
    });

    it("returns null when actorIds is an empty array (no filter applied)", () => {
      const filters: AuditLogFilters = { actorIds: [] };
      expect(actorWhere(filters)).toBeNull();
    });

    it("returns { actorUserId: { in: [...] } } for one or more UUIDs", () => {
      const filters: AuditLogFilters = { actorIds: [ACTOR_A] };
      expect(actorWhere(filters)).toEqual({ actorUserId: { in: [ACTOR_A] } });
      const filtersMulti: AuditLogFilters = { actorIds: [ACTOR_A, ACTOR_B] };
      expect(actorWhere(filtersMulti)).toEqual({
        actorUserId: { in: [ACTOR_A, ACTOR_B] },
      });
    });
  });

  describe("eventWhere", () => {
    it("returns null when event is undefined (no filter applied)", () => {
      const filters: AuditLogFilters = {};
      expect(eventWhere(filters)).toBeNull();
    });

    it("returns null when event is the empty string (no filter applied)", () => {
      const filters: AuditLogFilters = { event: "" };
      expect(eventWhere(filters)).toBeNull();
    });

    it("returns the { auditAction: { contains, mode: 'insensitive' } } shape for a substring", () => {
      const filters: AuditLogFilters = { event: "foo" };
      expect(eventWhere(filters)).toEqual({
        auditAction: { contains: "foo", mode: "insensitive" },
      });
    });

    it("escapes LIKE wildcards so `?event=%admin%` matches a literal substring", () => {
      const filters: AuditLogFilters = { event: "%admin%" };
      expect(eventWhere(filters)).toEqual({
        auditAction: { contains: "\\%admin\\%", mode: "insensitive" },
      });
    });

    it("escapes backslashes BEFORE adding LIKE escape characters", () => {
      const filters: AuditLogFilters = { event: "a\\b" };
      // The input `a\b` becomes `a\\b` (backslash escape) +
      // then `%`/`_` would become `\%`/`\_` (no-op here since
      // no wildcards). The double-backslash is required so
      // Postgres treats the literal `\` as content rather than
      // as the LIKE escape character.
      expect(eventWhere(filters)).toEqual({
        auditAction: { contains: "a\\\\b", mode: "insensitive" },
      });
    });
  });

  describe("resourceWhere", () => {
    it("returns null when resource is undefined (no filter applied)", () => {
      const filters: AuditLogFilters = {};
      expect(resourceWhere(filters)).toBeNull();
    });

    it("returns null when resource is the empty string (no filter applied)", () => {
      const filters: AuditLogFilters = { resource: "" };
      expect(resourceWhere(filters)).toBeNull();
    });

    it("returns { resource: { equals: ... } } for a closed-enum value", () => {
      const filters: AuditLogFilters = { resource: "Incident" };
      expect(resourceWhere(filters)).toEqual({ resource: { equals: "Incident" } });
    });
  });

  describe("dateRangeWhere", () => {
    it("returns null when neither since nor until is set", () => {
      const filters: AuditLogFilters = {};
      expect(dateRangeWhere(filters)).toBeNull();
    });

    it("returns { createdAt: { gte } } when only since is set", () => {
      const filters: AuditLogFilters = { since: SINCE };
      expect(dateRangeWhere(filters)).toEqual({ createdAt: { gte: SINCE } });
    });

    it("returns { createdAt: { lt } } when only until is set", () => {
      const filters: AuditLogFilters = { until: UNTIL };
      expect(dateRangeWhere(filters)).toEqual({ createdAt: { lt: UNTIL } });
    });

    it("returns { createdAt: { gte, lt } } when both since and until are set", () => {
      const filters: AuditLogFilters = { since: SINCE, until: UNTIL };
      expect(dateRangeWhere(filters)).toEqual({
        createdAt: { gte: SINCE, lt: UNTIL },
      });
    });
  });

  describe("toPrismaWhere", () => {
    it("returns an empty object when no filters are set (unfiltered admin listing)", () => {
      const filters: AuditLogFilters = {};
      expect(toPrismaWhere(filters)).toEqual({});
    });

    it("AND-s every filter into a single where clause", () => {
      const filters: AuditLogFilters = {
        actorIds: [ACTOR_A],
        event: "incident",
        resource: "Incident",
        since: SINCE,
        until: UNTIL,
      };
      expect(toPrismaWhere(filters)).toEqual({
        actorUserId: { in: [ACTOR_A] },
        auditAction: { contains: "incident", mode: "insensitive" },
        resource: { equals: "Incident" },
        createdAt: { gte: SINCE, lt: UNTIL },
      });
    });

    it("omits a key entirely when the corresponding helper returns null", () => {
      // `actorIds` is undefined → no `actorUserId` key.
      // `event` is "" → no `auditAction` key.
      // `resource` is "Incident" → `resource` key present.
      const filters: AuditLogFilters = { resource: "Incident" };
      const where = toPrismaWhere(filters);
      expect(where).toEqual({ resource: { equals: "Incident" } });
      expect("actorUserId" in where).toBe(false);
      expect("auditAction" in where).toBe(false);
      expect("createdAt" in where).toBe(false);
    });
  });
});
