/**
 * `IncidentDetailActions.spec.tsx` — Story 4.5.
 *
 * Unit tests for the Acknowledge button's visibility logic. Mirrors
 * the Story 4.1 contract: `actionSlotsFor(incident, viewerRole)` is
 * the SINGLE source of truth for which actions render.
 *
 * Coverage matrix (parameterized over the four-role RBAC contract
 * so AC #1 "Admin OR Operator" and AC #3 "Technician OR Viewer"
 * are both pinned):
 *
 *   1. OPEN + Admin          → button visible.   (AC #1)
 *   2. OPEN + Operator       → button visible.   (AC #1)
 *   3. OPEN + Technician     → button NOT visible. (AC #3)
 *   4. OPEN + Viewer         → button NOT visible. (AC #3)
 *   5. ACKNOWLEDGED + Operator → button NOT visible. (AC #2 — past OPEN)
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
          isPending={false}
          onAcknowledge={() => undefined}
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
        // The component returns `null` — no actions region, no button.
        expect(screen.queryByTestId("incident-detail-actions")).toBeNull();
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
