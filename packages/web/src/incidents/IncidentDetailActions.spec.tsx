/**
 * `IncidentDetailActions.spec.tsx` — Story 4.5 + Story 4.6.
 *
 * Unit tests for the Acknowledge button (Story 4.5) + Assign
 * inline form (Story 4.6) visibility logic. Mirrors the Story 4.1
 * contract: `actionSlotsFor(incident, viewerRole)` is the SINGLE
 * source of truth for which actions render.
 *
 * Coverage matrix (parameterized over the four-role RBAC contract
 * so AC #1 "Admin OR Operator" and AC #3 "Technician OR Viewer"
 * are both pinned):
 *
 * Story 4.5 — Acknowledge button:
 *   1. OPEN + Admin          → Acknowledge visible.   (4.5 AC #1)
 *   2. OPEN + Operator       → Acknowledge visible.   (4.5 AC #1)
 *   3. OPEN + Technician     → Acknowledge NOT visible. (4.5 AC #3)
 *   4. OPEN + Viewer         → Acknowledge NOT visible. (4.5 AC #3)
 *   5. ACKNOWLEDGED + Operator → Acknowledge NOT visible. (4.5 AC #2 — past OPEN)
 *
 * Story 4.6 — Assign inline form (new):
 *   6. OPEN + Operator       → Assign NOT visible (4.1 slot matrix: OPEN+Operator = ["acknowledge"] only)
 *   7. ACKNOWLEDGED + Admin  → Assign visible.   (4.6 AC #1)
 *   8. ACKNOWLEDGED + Operator → Assign visible.   (4.6 AC #1)
 *   9. ACKNOWLEDGED + Technician → Assign NOT visible. (4.6 AC #3)
 *  10. ACKNOWLEDGED + Viewer → Assign NOT visible. (4.6 AC #3)
 *
 * The mutation wiring (`isAck`, `isAssign`,
 * `onAcknowledge`, `onAssign`) is the `IncidentDetailPage.spec.tsx`'s
 * job — those tests mount the full detail page so they can drive
 * the buttons' real behavior. This spec file pins the visibility
 * contract only.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("Story 4.5 — IncidentDetailActions visibility (Acknowledge button)", () => {
  // Parameterized over the full four-role RBAC matrix. AC #1 names
  // "Admin OR Operator"; AC #3 names "Technician OR Viewer". A
  // coincidental green on Technician alone is not a four-role pin —
  // we exercise all four roles explicitly.
  describe.each([
    { role: "Admin", expectVisible: true },
    { role: "Operator", expectVisible: true },
    { role: "Technician", expectVisible: false },
    { role: "Viewer", expectVisible: false },
  ] as const)("OPEN + $role", ({ role, expectVisible }) => {
    it(`${expectVisible ? "renders" : "does NOT render"} the Acknowledge button`, () => {
      const incident = makeIncident({ state: "OPEN" });
      render(
        <IncidentDetailActions
          incident={incident}
          viewerRole={role}
          isAck={false}
          isAssign={false}
          onAcknowledge={() => undefined}
          onAssign={() => undefined}
        />,
      );
      if (expectVisible) {
        expect(screen.getByTestId("incident-detail-actions")).toBeInTheDocument();
        expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
        expect(screen.getByTestId("incident-detail-acknowledge-button")).toHaveTextContent(
          "Acknowledge",
        );
        expect(screen.getByTestId("incident-detail-acknowledge-button")).not.toBeDisabled();
      } else {
        // No actions region OR no Acknowledge button. For OPEN + Tech/Viewer
        // the actions region also lacks the Assign form (4.1 matrix: those
        // roles return [] for OPEN), so the whole region is `null`.
        expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
      }
    });
  });

  it("does NOT render the Acknowledge button for ACKNOWLEDGED + Operator (NOT_OPEN)", () => {
    const incident = makeIncident({ state: "ACKNOWLEDGED" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isAck={false}
        isAssign={false}
        onAcknowledge={() => undefined}
        onAssign={() => undefined}
      />,
    );
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
  });

  it("disables the Acknowledge button while the mutation is in flight (MUTATION_IN_FLIGHT)", () => {
    const incident = makeIncident({ state: "OPEN" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isAck={true}
        isAssign={false}
        onAcknowledge={() => undefined}
        onAssign={() => undefined}
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
        isAck={false}
        isAssign={false}
        onAcknowledge={onAcknowledge}
        onAssign={() => undefined}
      />,
    );
    screen.getByTestId("incident-detail-acknowledge-button").click();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Story 4.6 — IncidentDetailActions visibility (Assign inline form)
// ============================================================================
//
// Pinned here (not just at the page integration level) so a regression
// that introduced an inline role check inside `IncidentDetailActions`
// (bypassing `actionSlotsFor`) would fail at the unit-test seam.
describe("Story 4.6 — IncidentDetailActions visibility (Assign inline form)", () => {
  // Parameterized over the four-role RBAC matrix for the Assign slot.
  // AC #1 names "Admin OR Operator"; AC #3 names "Technician OR Viewer".
  // A coincidental green on Technician alone is not a four-role pin.
  describe.each([
    { role: "Admin", expectVisible: true },
    { role: "Operator", expectVisible: true },
    { role: "Technician", expectVisible: false },
    { role: "Viewer", expectVisible: false },
  ] as const)("ACKNOWLEDGED + $role", ({ role, expectVisible }) => {
    it(`${expectVisible ? "renders" : "does NOT render"} the Assign inline form`, () => {
      const incident = makeIncident({ state: "ACKNOWLEDGED" });
      render(
        <IncidentDetailActions
          incident={incident}
          viewerRole={role}
          isAck={false}
          isAssign={false}
          onAcknowledge={() => undefined}
          onAssign={() => undefined}
        />,
      );
      if (expectVisible) {
        // Actions region visible; Assign form mounted; Acknowledge
        // button NOT visible (the slot for `acknowledge` is absent
        // for ACKNOWLEDGED + Admin/Operator per the 4.1 matrix).
        expect(screen.getByTestId("incident-detail-actions")).toBeInTheDocument();
        expect(screen.getByTestId("incident-detail-assign-form")).toBeInTheDocument();
        expect(screen.getByTestId("incident-detail-assign-button")).toBeInTheDocument();
        expect(screen.getByTestId("incident-detail-assign-select")).toBeInTheDocument();
        expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
      } else {
        // No actions region (slot matrix returns [] for Tech/Viewer
        // at ACKNOWLEDGED), no Assign form, no Assign button.
        expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
        expect(screen.queryByTestId("incident-detail-assign-button")).toBeNull();
      }
    });
  });

  it("does NOT render the Assign form for OPEN + Operator (NOT_OPEN — only Acknowledge is available)", () => {
    const incident = makeIncident({ state: "OPEN" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isAck={false}
        isAssign={false}
        onAcknowledge={() => undefined}
        onAssign={() => undefined}
      />,
    );
    // OPEN + Operator slot matrix = ["acknowledge"]; Assign slot is absent.
    expect(screen.getByTestId("incident-detail-acknowledge-button")).toBeInTheDocument();
    expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
    expect(screen.queryByTestId("incident-detail-assign-button")).toBeNull();
  });

  it("does NOT render the Assign form for INSPECTING + Admin (slot matrix is empty)", () => {
    const incident = makeIncident({ state: "INSPECTING" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Admin"
        isAck={false}
        isAssign={false}
        onAcknowledge={() => undefined}
        onAssign={() => undefined}
      />,
    );
    // INSPECTING state — 4.1's `slotsForInspecting` returns [] for non-Technician
    // owners; Admin sees nothing. Acknowledge already disappeared; Assign must too.
    expect(screen.queryByTestId("incident-detail-acknowledge-button")).toBeNull();
    expect(screen.queryByTestId("incident-detail-assign-form")).toBeNull();
    expect(screen.queryByTestId("incident-detail-assign-button")).toBeNull();
  });

  it("disables the Assign button while no Technician is selected (NO_TECH_SELECTED)", () => {
    const incident = makeIncident({ state: "ACKNOWLEDGED" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isAck={false}
        isAssign={false}
        onAcknowledge={() => undefined}
        onAssign={() => undefined}
      />,
    );
    const button = screen.getByTestId("incident-detail-assign-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Assign");
  });

  it("fires onAssign with the selected Technician id when a Technician is picked + Assign is clicked", () => {
    const incident = makeIncident({ state: "ACKNOWLEDGED" });
    const onAssign = vi.fn();
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isAck={false}
        isAssign={false}
        onAcknowledge={() => undefined}
        onAssign={onAssign}
      />,
    );

    // Pick the first seeded Technician from the select.
    const select = screen.getByTestId("incident-detail-assign-select");
    const TECH_ID = (select.querySelector("option[value]:not([value=''])") as HTMLOptionElement)
      ?.value;
    expect(TECH_ID).toBeTruthy();
    fireEvent.change(select, { target: { value: TECH_ID } });

    // Button now enabled.
    const button = screen.getByTestId("incident-detail-assign-button");
    expect(button).not.toBeDisabled();

    button.click();
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign).toHaveBeenCalledWith(TECH_ID);
  });

  it("disables the Assign button while the assign mutation is in flight (MUTATION_IN_FLIGHT)", () => {
    const incident = makeIncident({ state: "ACKNOWLEDGED" });
    render(
      <IncidentDetailActions
        incident={incident}
        viewerRole="Operator"
        isAck={false}
        isAssign={true}
        onAcknowledge={() => undefined}
        onAssign={() => undefined}
      />,
    );
    const button = screen.getByTestId("incident-detail-assign-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Assigning...");
  });
});
