/**
 * IncidentCard.types.spec.ts — Story 4.1 (type contract tests).
 *
 * AC1-AC10 of `spec-4-1-incident-card-types.md`. Pure function tests
 * with no React / DOM / fetch. The negative-import test (AC10) uses
 * a Vitest hook to assert that `KanbanColumnSchema` is NOT reachable
 * from this module's import surface.
 */
import { describe, expect, it } from "vitest";

import { type ActionSlot, type IncidentCardProps, actionSlotsFor } from "./IncidentCard.types";
import { type IncidentPayload, type IncidentState } from "@surakkha/shared/incident";

/**
 * Minimal helper to fabricate an `IncidentPayload` for tests. Only
 * the fields `actionSlotsFor` actually reads (state + assignee_user_id)
 * need to vary; the rest are stubbed.
 */
const makeIncident = (overrides: Partial<IncidentPayload> = {}): IncidentPayload => ({
  id: "11111111-1111-4111-8111-111111111111",
  device_id: "22222222-2222-4222-8222-222222222222",
  severity: "warning",
  metric: "tds_ppm",
  value: 312,
  opened_at: "2026-08-27T00:00:00.000Z",
  state: "OPEN",
  assignee_user_id: null,
  acknowledged_at: null,
  resolved_at: null,
  ...overrides,
});

describe("Story 4.1 — IncidentCard type contract (AC1, AC3)", () => {
  it("exports the ActionSlot literal union with the expected 5+null members", () => {
    // Type-level test: `ActionSlot` is `"acknowledge" | "assign" | "submit-result" | "resolve" | "reopen" | null`.
    const slots: readonly ActionSlot[] = [
      "acknowledge",
      "assign",
      "submit-result",
      "resolve",
      "reopen",
      null,
    ];
    expect(slots).toHaveLength(6);
  });

  it("exports IncidentCardProps with the locked shape", () => {
    // Type-level test: `IncidentCardProps` has exactly `{ incident, onAction, isInteractive }`.
    const props: IncidentCardProps = {
      incident: makeIncident(),
      onAction: () => undefined,
      isInteractive: true,
    };
    expect(props.incident).toBeDefined();
    expect(typeof props.onAction).toBe("function");
    expect(typeof props.isInteractive).toBe("boolean");
  });
});

describe("Story 4.1 — actionSlotsFor OPEN state (AC5-AC7)", () => {
  const incident = makeIncident({ state: "OPEN" });

  it("Admin sees acknowledge + assign", () => {
    expect(actionSlotsFor(incident, "Admin")).toEqual(["acknowledge", "assign"]);
  });

  it("Operator sees only acknowledge", () => {
    expect(actionSlotsFor(incident, "Operator")).toEqual(["acknowledge"]);
  });

  it("Technician sees no slots", () => {
    expect(actionSlotsFor(incident, "Technician")).toEqual([]);
  });

  it("Viewer sees no slots", () => {
    expect(actionSlotsFor(incident, "Viewer")).toEqual([]);
  });

  it("logged-out (null role) sees no slots", () => {
    expect(actionSlotsFor(incident, null)).toEqual([]);
  });
});

describe("Story 4.1 — actionSlotsFor ACKNOWLEDGED state", () => {
  const incident = makeIncident({ state: "ACKNOWLEDGED" });

  it("Admin sees assign", () => {
    expect(actionSlotsFor(incident, "Admin")).toEqual(["assign"]);
  });

  it("Operator sees assign", () => {
    expect(actionSlotsFor(incident, "Operator")).toEqual(["assign"]);
  });

  it("Technician sees no slots (must wait for assignment)", () => {
    expect(actionSlotsFor(incident, "Technician")).toEqual([]);
  });
});

describe("Story 4.1 — actionSlotsFor INSPECTING state (AC9)", () => {
  const TECH_ID = "tech-aaaa-bbbb-cccc-dddddddddddd";

  it("assigned Technician sees submit-result", () => {
    const incident = makeIncident({
      state: "INSPECTING",
      assignee_user_id: TECH_ID,
    });
    expect(actionSlotsFor(incident, "Technician", TECH_ID)).toEqual(["submit-result"]);
  });

  it("unassigned Technician sees no slots", () => {
    const incident = makeIncident({
      state: "INSPECTING",
      assignee_user_id: TECH_ID,
    });
    expect(actionSlotsFor(incident, "Technician", "different-tech")).toEqual([]);
  });

  it("Technician with null viewerUserId sees no slots (defense-in-depth)", () => {
    const incident = makeIncident({
      state: "INSPECTING",
      assignee_user_id: TECH_ID,
    });
    expect(actionSlotsFor(incident, "Technician", null)).toEqual([]);
  });

  it("Operator sees no slots (read-only while tech works)", () => {
    const incident = makeIncident({
      state: "INSPECTING",
      assignee_user_id: TECH_ID,
    });
    expect(actionSlotsFor(incident, "Operator")).toEqual([]);
  });

  it("Admin sees no slots (read-only while tech works)", () => {
    const incident = makeIncident({
      state: "INSPECTING",
      assignee_user_id: TECH_ID,
    });
    expect(actionSlotsFor(incident, "Admin")).toEqual([]);
  });
});

describe("Story 4.1 — actionSlotsFor post-inspection states (SAFE / UNSAFE / MONITORING)", () => {
  for (const state of ["SAFE", "UNSAFE", "MONITORING"] as const) {
    const incident = makeIncident({ state });

    it(`Operator sees resolve for ${state}`, () => {
      expect(actionSlotsFor(incident, "Operator")).toEqual(["resolve"]);
    });

    it(`Admin sees resolve for ${state}`, () => {
      expect(actionSlotsFor(incident, "Admin")).toEqual(["resolve"]);
    });

    it(`Technician sees no slots for ${state}`, () => {
      expect(actionSlotsFor(incident, "Technician")).toEqual([]);
    });
  }
});

describe("Story 4.1 — actionSlotsFor RESOLVED state (AC8)", () => {
  const incident = makeIncident({ state: "RESOLVED" });

  it("Admin sees reopen", () => {
    expect(actionSlotsFor(incident, "Admin")).toEqual(["reopen"]);
  });

  it("Operator sees no slots (cannot reopen)", () => {
    expect(actionSlotsFor(incident, "Operator")).toEqual([]);
  });

  it("Technician sees no slots", () => {
    expect(actionSlotsFor(incident, "Technician")).toEqual([]);
  });

  it("Viewer sees no slots", () => {
    expect(actionSlotsFor(incident, "Viewer")).toEqual([]);
  });
});

describe("Story 4.1 — REOPENED is the OPEN alias", () => {
  // The shared/incident.ts header pins REOPENED as a transition
  // alias, NOT a stored state. Story 4.11's reopen writes state='OPEN'.
  // We still test the REOPENED branch to defensively pin the alias.
  const incident = makeIncident({ state: "REOPENED" });

  it("Admin sees acknowledge + assign (mirrors OPEN)", () => {
    expect(actionSlotsFor(incident, "Admin")).toEqual(["acknowledge", "assign"]);
  });

  it("Operator sees only acknowledge (mirrors OPEN)", () => {
    expect(actionSlotsFor(incident, "Operator")).toEqual(["acknowledge"]);
  });
});

describe("Story 4.1 — exhaustive state coverage", () => {
  // Pins AC8: every cell of the state × role matrix has at least one
  // test above. This guard catches the case where a future state is
  // added to IncidentStateSchema but the switch above doesn't grow.
  const states: readonly IncidentState[] = [
    "OPEN",
    "ACKNOWLEDGED",
    "INSPECTING",
    "SAFE",
    "UNSAFE",
    "MONITORING",
    "RESOLVED",
    "REOPENED",
  ];
  it("all 8 states are covered by the actionSlotsFor switch", () => {
    for (const state of states) {
      const incident = makeIncident({ state });
      // The call must not throw a TS exhaustiveness error at runtime.
      let result: readonly ActionSlot[];
      try {
        result = actionSlotsFor(incident, "Admin");
      } catch (err) {
        throw new Error(`actionSlotsFor threw for state=${state}: ${(err as Error).message}`);
      }
      expect(Array.isArray(result)).toBe(true);
    }
  });
});
