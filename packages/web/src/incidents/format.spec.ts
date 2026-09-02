/**
 * `format.spec.ts` — pure-helper coverage for the audit-timeline
 * format helpers. Pins the per-verb message matrix + the actor
 * (`you` / `anonymous` / role-inferred) surface + the
 * timestamp-bucket thresholds.
 */
import { type IncidentEventPayload } from "@surakkha/shared/incident";
import { describe, expect, it } from "vitest";

import {
  formatActorOrAnonymous,
  formatAssigneeLabel,
  formatDateOrDash,
  formatTimelineEventSummary,
  formatTimelineTimestamp,
} from "./format";

const VIEWER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const event = (overrides: Partial<IncidentEventPayload>): IncidentEventPayload => ({
  id: "evt-1",
  incident_id: "inc-1",
  type: "acknowledge",
  actor_user_id: OTHER,
  payload: {},
  created_at: new Date().toISOString(),
  ...overrides,
});

describe("formatDateOrDash", () => {
  it("returns '—' when null", () => {
    expect(formatDateOrDash(null)).toBe("—");
  });

  it("returns YYYY-MM-DD when valid ISO", () => {
    expect(formatDateOrDash("2026-09-02T12:34:56.000Z")).toBe("2026-09-02");
  });
});

describe("formatActorOrAnonymous", () => {
  it("returns 'anonymous' when actor is null", () => {
    expect(formatActorOrAnonymous(null, "acknowledge", VIEWER)).toBe("anonymous");
  });

  it("returns 'you' when actor is the viewer", () => {
    expect(formatActorOrAnonymous(VIEWER, "acknowledge", VIEWER)).toBe("you");
  });

  it("returns 'a Technician' for submit_result", () => {
    expect(formatActorOrAnonymous(OTHER, "submit_result", VIEWER)).toBe("a Technician");
  });

  it("returns 'another operator' for acknowledge by other", () => {
    expect(formatActorOrAnonymous(OTHER, "acknowledge", VIEWER)).toBe("another operator");
  });
});

describe("formatAssigneeLabel", () => {
  it("returns 'unassigned' when null", () => {
    expect(formatAssigneeLabel(null, VIEWER)).toBe("unassigned");
  });

  it("returns 'you' when the viewer is the assignee", () => {
    expect(formatAssigneeLabel(VIEWER, VIEWER)).toBe("you");
  });

  it("returns 'a Technician' otherwise", () => {
    expect(formatAssigneeLabel(OTHER, VIEWER)).toBe("a Technician");
  });
});

describe("formatTimelineTimestamp", () => {
  const NOW = Date.now();
  const isoFrom = (deltaMs: number): string => new Date(NOW - deltaMs).toISOString();

  it("returns 'just now' for < 1 minute", () => {
    expect(formatTimelineTimestamp(isoFrom(30_000))).toBe("just now");
  });

  it("returns 'N min ago' for minutes", () => {
    expect(formatTimelineTimestamp(isoFrom(5 * 60_000))).toBe("5 min ago");
  });

  it("returns 'N h ago' for hours", () => {
    expect(formatTimelineTimestamp(isoFrom(3 * 3_600_000))).toBe("3 h ago");
  });

  it("returns 'N d ago' for days", () => {
    expect(formatTimelineTimestamp(isoFrom(2 * 86_400_000))).toBe("2 d ago");
  });

  it("returns YYYY-MM-DD for > 1 week", () => {
    expect(formatTimelineTimestamp("2026-08-20T00:00:00.000Z")).toBe("2026-08-20");
  });

  it("returns the original string when NaN", () => {
    expect(formatTimelineTimestamp("not-an-iso")).toBe("not-an-iso");
  });
});

describe("formatTimelineEventSummary", () => {
  it("acknowledge", () => {
    expect(formatTimelineEventSummary(event({ type: "acknowledge" }), VIEWER)).toBe(
      "Acknowledged by another operator.",
    );
  });

  it("assign — reads assigneeUserId", () => {
    expect(
      formatTimelineEventSummary(
        event({ type: "assign", payload: { assigneeUserId: "tech-7" } }),
        VIEWER,
      ),
    ).toBe("Assigned to tech-7 by another operator.");
  });

  it("submit_result — SAFE", () => {
    expect(
      formatTimelineEventSummary(
        event({ type: "submit_result", payload: { outcome: "SAFE" } }),
        VIEWER,
      ),
    ).toBe("Marked safe by a Technician.");
  });

  it("resolve", () => {
    expect(formatTimelineEventSummary(event({ type: "resolve" }), VIEWER)).toBe(
      "Resolved by another operator.",
    );
  });

  it("reopen — with reason", () => {
    expect(
      formatTimelineEventSummary(
        event({ type: "reopen", payload: { reason: "device moved" } }),
        VIEWER,
      ),
    ).toBe('Reopened by another operator — "device moved".');
  });

  it("reopen — without reason", () => {
    expect(formatTimelineEventSummary(event({ type: "reopen", payload: {} }), VIEWER)).toBe(
      'Reopened by another operator — "no reason given".',
    );
  });

  it("invalid_transition_attempt", () => {
    expect(
      formatTimelineEventSummary(
        event({
          type: "invalid_transition_attempt",
          payload: { from: "RESOLVED", attempted: "acknowledge" },
        }),
        VIEWER,
      ),
    ).toBe("Rejected: acknowledge from RESOLVED is not a valid transition.");
  });
});
