/**
 * IncidentCard — type contract (Story 4.1).
 *
 * This file is **types-only**. The `<IncidentCard />` React component
 * ships in Story 4.4 (deferred). Establishing the type surface first
 * is the Epic 2/3 pattern: contract today, rendering tomorrow.
 * Future consumers (Kanban column cards, detail page header, Toast
 * targets) read from this module so the contract is the single
 * source of truth.
 *
 * Why pure types (no React, no DOM, no fetch):
 *
 *   - **Epic 2's read-only incident preview** consumes this. That
 *     preview is server-side rendered in the dashboard's empty-state
 *     branch; coupling to React would force a JS runtime in the read
 *     path.
 *
 *   - **Story 4.4's preview / 4.5's acknowledge UI / 4.6's assignment
 *     modal** all need a shared action-slot derivation. A pure function
 *     can be tested without `render()`.
 *
 *   - **Story 4.3's column projection** deliberately does NOT own
 *     this — the Kanban column is a derived projection over state +
 *     severity, not over slots. The slot derivation lives here.
 *
 * Locked facts:
 *
 *   1. `IncidentPayloadSchema` (`@surakkha/shared/incident`) is the
 *      wire-row type; Story 4.1 imports it as a type-only import
 *      (`import type`) to avoid the module-load-time circular
 *      dependency on the api's Prisma client.
 *
 *   2. `ActionSlot` is a literal union of valid action identifiers;
 *      `null` is reserved for Epic 2's read-only preview (which
 *      always passes `null` to `onAction`).
 *
 *   3. The slots are derived from `incident.state`, NEVER from a
 *      column name. Tests pin this with a negative-import check
 *      (AC10 of spec-4-1).
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { type Role } from "@surakkha/shared/rbac";

/**
 * Action-slot identifiers. The `null` member is reserved for Epic 2's
 * read-only preview; production callers should never invoke
 * `onAction(null)`.
 *
 * Mirrors the `Action` RBAC enum's incident verbs 1:1.
 */
export type ActionSlot = "acknowledge" | "assign" | "submit-result" | "resolve" | "reopen" | null;

/**
 * `<IncidentCard />` props (deferred UI — Story 4.4). The component
 * reads from this contract only.
 *
 * `onAction` is the call-site for the parent (Kanban, detail page)
 * to dispatch the API mutation. `isInteractive === false` means the
 * card is read-only (Epic 2's preview); the component must not
 * invoke `onAction` in that mode.
 */
export interface IncidentCardProps {
  readonly incident: IncidentPayload;
  readonly onAction: (slot: ActionSlot) => void;
  readonly isInteractive: boolean;
}

/**
 * Derive the non-null action slots the viewer is allowed to invoke.
 * Pure function: same inputs always yield same outputs; no React,
 * no DOM, no fetch. Tested without `render()`.
 *
 * Slot derivation rules (Story 4.1 AC5-AC9) are encoded in
 * `STATE_SLOTS` (state → role → slots) so the orchestrator here is
 * a single lookup. Per-state special cases (INSPECTING ownership)
 * live in `slotsForInspecting`.
 *
 * `viewerUserId` is needed for the INSPECTING case (Technician-only-
 * mine ownership rule). Passing `null` while logged out skips the
 * ownership check and treats the viewer as if no slots were
 * available for INSPECTING.
 */
export const actionSlotsFor = (
  incident: IncidentPayload,
  viewerRole: Role | null,
  viewerUserId: string | null = null,
): readonly ActionSlot[] => {
  if (viewerRole === null) return [];
  if (incident.state === "INSPECTING") {
    return slotsForInspecting(incident.assignee_user_id, viewerUserId);
  }
  const perRole = STATE_SLOTS[incident.state];
  return perRole[viewerRole] ?? [];
};

/**
 * Per-state × per-role slot matrix. INSPECTING is special-cased
 * (Technician-only-mine ownership gate) so it's absent here; the
 * orchestrator dispatches it explicitly.
 *
 * REOPENED is a transition alias; the reopen writer normalizes to
 * OPEN before reaching this function — but for defensive slot
 * derivation we still treat REOPENED identically to OPEN.
 */
const STATE_SLOTS: Readonly<
  Record<
    Exclude<IncidentPayload["state"], "INSPECTING">,
    Readonly<Partial<Record<Role, ReadonlyArray<NonNullable<ActionSlot>>>>>
  >
> = {
  OPEN: {
    Admin: ["acknowledge", "assign"],
    Operator: ["acknowledge"],
  },
  REOPENED: {
    Admin: ["acknowledge", "assign"],
    Operator: ["acknowledge"],
  },
  ACKNOWLEDGED: {
    Admin: ["assign"],
    Operator: ["assign"],
  },
  SAFE: {
    Admin: ["resolve"],
    Operator: ["resolve"],
  },
  UNSAFE: {
    Admin: ["resolve"],
    Operator: ["resolve"],
  },
  MONITORING: {
    Admin: ["resolve"],
    Operator: ["resolve"],
  },
  RESOLVED: {
    Admin: ["reopen"],
  },
};

/**
 * INSPECTING state — only the assigned Technician sees submit-result.
 * Extracted for clarity (ownership rule is special-cased, not
 * derivable from a static matrix).
 */
const slotsForInspecting = (
  assigneeUserId: string | null,
  viewerUserId: string | null,
): readonly ActionSlot[] => {
  if (viewerUserId !== null && assigneeUserId === viewerUserId) {
    return ["submit-result"];
  }
  return [];
};
