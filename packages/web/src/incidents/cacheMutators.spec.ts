/**
 * `cacheMutators.spec.ts` — Story 4.4 step-04 review.
 *
 * Direct unit tests for the `cacheMutators.ts` shared helper.
 * The detail page's `useIncidentDetailSocket` and the Kanban's
 * `useKanbanBoardSocket` BOTH route through `applyTransitionToCachedRow`;
 * the silent-drop contract and the field-preservation contract
 * are tested here at the helper level so a regression in either
 * consumer is caught at the source.
 *
 * Coverage:
 *   - id mismatch returns `null` (silent drop)
 *   - id match returns a new row with `state` replaced
 *   - non-state fields are preserved verbatim
 *   - `to_state: "RESOLVED"` is NOT special-cased here (the
 *     per-hook wrapper decides drop-vs-keep)
 */
import { type IncidentPayload, type IncidentStateChangedEvent } from "@surakkha/shared/incident";
import { describe, expect, it } from "vitest";

import { applyTransitionToCachedRow } from "./cacheMutators";

const baseRow = (overrides: Partial<IncidentPayload> = {}): IncidentPayload => ({
  id: "11111111-1111-4111-8111-111111111111",
  device_id: "9b1c4f00-0000-4000-8000-000000000001",
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

const baseEvent = (
  overrides: Partial<IncidentStateChangedEvent> = {},
): IncidentStateChangedEvent => ({
  incident_id: "11111111-1111-4111-8111-111111111111",
  from_state: "OPEN",
  to_state: "ACKNOWLEDGED",
  changed_at: "2026-08-27T01:00:00.000Z",
  actor_user_id: "00000000-0000-4000-8000-00000000a001",
  ...overrides,
});

describe("Story 4.4 — applyTransitionToCachedRow", () => {
  it("returns null when the event's incident_id does not match the row's id (silent drop)", () => {
    const row = baseRow();
    const staleEvent = baseEvent({
      incident_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(applyTransitionToCachedRow(row, staleEvent)).toBeNull();
  });

  it("returns a new row with `state` replaced when ids match", () => {
    const row = baseRow({ state: "OPEN" });
    const event = baseEvent({ to_state: "ACKNOWLEDGED" });
    const next = applyTransitionToCachedRow(row, event);
    expect(next).not.toBeNull();
    expect(next?.state).toBe("ACKNOWLEDGED");
  });

  it("preserves every non-state field verbatim (no id / severity drift)", () => {
    const row = baseRow({
      state: "OPEN",
      severity: "critical",
      metric: "tds_ppm",
      value: 999,
      device_id: "9b1c4f00-0000-4000-8000-000000000099",
      assignee_user_id: "00000000-0000-4000-8000-00000000a002",
    });
    const event = baseEvent({ to_state: "ACKNOWLEDGED" });
    const next = applyTransitionToCachedRow(row, event);
    expect(next).toEqual({
      ...row,
      state: "ACKNOWLEDGED",
    });
  });

  it("does NOT special-case RESOLVED — the helper only swaps `state`", () => {
    const row = baseRow({ state: "ACKNOWLEDGED" });
    const event = baseEvent({
      from_state: "ACKNOWLEDGED",
      to_state: "RESOLVED",
    });
    const next = applyTransitionToCachedRow(row, event);
    // The detail hook's wrapper decides drop-vs-keep. This helper
    // just replaces the state field — pin that contract.
    expect(next).toEqual({
      ...row,
      state: "RESOLVED",
    });
  });

  it("returns a NEW object (does not mutate the input row)", () => {
    const row = baseRow({ state: "OPEN" });
    const snapshot = { ...row };
    const event = baseEvent({ to_state: "ACKNOWLEDGED" });
    applyTransitionToCachedRow(row, event);
    expect(row).toEqual(snapshot);
  });
});
