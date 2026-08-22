/**
 * Tests for `@surakkha/shared/rbac` (Story 1.1).
 *
 * The matrix is the canonical authority source for v1; these tests pin the
 * shape, the explicit-grant invariant, and the fail-closed predicate. Story
 * 1.8 (negative RBAC tests) wires up the api middleware and exercises the
 * matrix end-to-end.
 */
import { describe, expect, it } from "vitest";

import {
  ActionSchema,
  AuditActionSchema,
  RBAC_MATRIX,
  RBAC_NEGATIVE_CASES,
  ResourceSchema,
  RoleSchema,
  isAllowed,
} from "./index.js";

describe("RBAC matrix shape", () => {
  it("covers exactly four roles", () => {
    expect(RoleSchema.options).toEqual([
      "Admin",
      "Operator",
      "Technician",
      "Viewer",
    ]);
    expect(Object.keys(RBAC_MATRIX).sort()).toEqual([
      "Admin",
      "Operator",
      "Technician",
      "Viewer",
    ]);
  });

  it("covers every action from the appendix for at least one resource", () => {
    const everyAction = ActionSchema.options;
    for (const action of everyAction) {
      const someCell =
        Object.values(RBAC_MATRIX).some(
          (row) => (row as Record<string, unknown>)[action] !== undefined,
        );
      expect(someCell, `action ${action} is not referenced by any role`).toBe(true);
    }
  });

  it("covers every resource from the appendix for at least one (role, action)", () => {
    const everyResource = ResourceSchema.options;
    for (const resource of everyResource) {
      const referenced = Object.values(RBAC_MATRIX).some((row) =>
        Object.values(row as Record<string, unknown>).some(
          (cell) =>
            typeof cell === "object" &&
            cell !== null &&
            (cell as Record<string, boolean>)[resource] !== undefined,
        ),
      );
      expect(referenced, `resource ${resource} is not referenced by any role/action`).toBe(true);
    }
  });

  it("does not implicitly grant Admin every action", () => {
    // If Admin had a wildcard, every cell would be true. Pick one that is
    // canonically `no` per the appendix and assert it.
    expect(
      RBAC_MATRIX.Admin.acknowledge.Incident,
    ).toBe(true); // sanity: a real `yes`
    expect(
      RBAC_MATRIX.Admin.submit_result.Incident,
    ).toBe(false); // canonically `no` (Technician-only)
    expect(
      RBAC_MATRIX.Admin.read.AuditLog,
    ).toBe(true); // sanity: a real `yes`
    expect(
      RBAC_MATRIX.Admin.read.Simulator,
    ).toBe(false); // canonically `no`
  });
});

describe("isAllowed()", () => {
  it("admits Admin → manage → User", () => {
    expect(
      isAllowed({ subject: "Admin", action: "manage", resource: "User" }),
    ).toBe(true);
  });

  it("denies Operator → read → AuditLog", () => {
    expect(
      isAllowed({ subject: "Operator", action: "read", resource: "AuditLog" }),
    ).toBe(false);
  });

  it("denies Viewer → create → Incident", () => {
    expect(
      isAllowed({ subject: "Viewer", action: "create", resource: "Incident" }),
    ).toBe(false);
  });

  it("admits Technician → submit_result → Incident (ownership checked later)", () => {
    expect(
      isAllowed({
        subject: "Technician",
        action: "submit_result",
        resource: "Incident",
      }),
    ).toBe(true);
  });

  it("fails closed on an unknown action", () => {
    // Loose-typed triple simulates a drift bug at the boundary.
    expect(isAllowed({ subject: "Admin", action: "promote", resource: "User" })).toBe(false);
  });

  it("fails closed on an unknown resource", () => {
    expect(isAllowed({ subject: "Admin", action: "read", resource: "Galaxy" })).toBe(false);
  });
});

describe("RBAC_NEGATIVE_CASES registry", () => {
  it("contains at least 10 entries", () => {
    expect(RBAC_NEGATIVE_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it("every case points at a real row in the matrix", () => {
    for (const c of RBAC_NEGATIVE_CASES) {
      // We only assert the case is well-formed (role + endpoint). Story 1.8
      // wires these up against a live handler.
      expect(RoleSchema.options).toContain(c.subject);
      expect(c.endpoint).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
      expect([401, 403]).toContain(c.expected);
    }
  });
});

describe("AuditActionSchema (Story 2.2 extension)", () => {
  it("includes the four Story 2.2 ingest values", () => {
    expect(AuditActionSchema.options).toContain("reading_ingested");
    expect(AuditActionSchema.options).toContain("reading_rate_limited");
    expect(AuditActionSchema.options).toContain("seq_drop_detected");
    // F-P7: late-frame reorder is distinct from gap-detection;
    // both reach the audit pipeline via `IngestHooks.onAuditAppend`.
    expect(AuditActionSchema.options).toContain("seq_reorder_detected");
  });

  it("parses every enum value without error", () => {
    for (const value of AuditActionSchema.options) {
      expect(AuditActionSchema.parse(value)).toBe(value);
    }
  });

  it("rejects an unknown audit action (fail-closed enum)", () => {
    expect(AuditActionSchema.safeParse("not-a-real-action").success).toBe(false);
  });
});
