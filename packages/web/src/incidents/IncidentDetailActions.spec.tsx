/**
 * `IncidentDetailActions.spec.tsx` — Story 4.5.
 *
 * Unit tests for the Acknowledge button's visibility logic. Mirrors
 * the Story 4.1 contract: `actionSlotsFor(incident, viewerRole)` is
 * the SINGLE source of truth for which actions render. Three cases:
 *
 *   1. OPEN + Operator       → button visible.
 *   2. OPEN + Technician     → button NOT visible (RBAC: Technician
 *                              cannot acknowledge).
 *   3. ACKNOWLEDGED + Operator → button NOT visible (state is past
 *                              OPEN; no slot returned by `actionSlotsFor`).
 *
 * The mutation wiring (`isPending`, `onAcknowledge`) is the
 * `IncidentDetailPage.spec.tsx`'s job — those tests mount the full
 * detail page so they can drive the button's real behavior. This
 * spec file pins the visibility contract only.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IncidentDetailActions } from "./IncidentDetailActions";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";

const makeIncident = (overrides: Partial<IncidentPayload> = {}): IncidentPayload => ({
  id: INCIDENT_ID,
  device_id: DEVICE_A,
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

afterEach(() => {
  cleanup();
});

describe("Story 4.5 — IncidentDetailActions visibility", () => {
  it("renders the Acknowledge button for OPEN + Operator", () => {
    const incident = makeIncident({ state: "OPEN" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isPending={false}
        onAcknowledge={() => undefined}
      />,
    );
    expect(screen.getByTestId("incident-detail-actions")).toBeInTheDocument();
    expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    expect(screen.getByTestId("incident-detail-acknowledge-button")).toHaveTextContent(
      "Acknowledge",
    );
    expect(screen.getByTestId("incident-detail-acknowledge-button")).not.toBeDisabled();
  });

  it("does NOT render the Acknowledge button for OPEN + Technician (RBAC)", () => {
    const incident = makeIncident({ state: "OPEN" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Technician"
        isPending={false}
        onAcknowledge={() => undefined}
      />,
    );
    // The component returns `null` — no actions region, no button.
    expect(screen.queryByTestId("incident-detail-actions")).toBeNull();
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
  });

  it("does NOT render the Acknowledge button for ACKNOWLEDGED + Operator (NOT_OPEN)", () => {
    const incident = makeIncident({ state: "ACKNOWLEDGED" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isPending={false}
        onAcknowledge={() => undefined}
      />,
    );
    expect(screen.queryByTestId("incident-detail-actions")).toBeNull();
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
  });

  it("disables the button while the mutation is in flight (MUTATION_IN_FLIGHT)", () => {
    const incident = makeIncident({ state: "OPEN" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isPending={true}
        onAcknowledge={() => undefined}
      />,
    );
    const button = screen.getByTestId("incident-detail-acknowledge-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Acknowledging...");
  });

  it("fires onAcknowledge on click", () => {
    const incident = makeIncident({ state: "OPEN" });
    const onAcknowledge = vi.fn();
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isPending={false}
        onAcknowledge={onAcknowledge}
      />,
    );
    screen.getByTestId("incident-detail-acknowledge-button").click();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});
