/**
 * IncidentCard — type contract. Pure types (no React, no DOM, no
 * fetch) so the Epic 2 server-rendered preview can consume the
 * action-slot derivation without a JS runtime. The `<IncidentCard />`
 * UI ships separately; this module owns the contract only.
 *
 * Slot rules:
 *   - `null` member of `ActionSlot` is reserved for the read-only
 *     preview; production callers should never invoke `onAction(null)`.
 *   - Slots are derived from `incident.state`, never from a column
 *     name (Kanban dispatch reads from this matrix).
 *   - INSPECTING is special-cased (Technician-only-mine ownership);
 *     `slotsForInspecting` keeps the ownership rule role-free.
 *   - REOPENED is a transition alias normalised to OPEN before this
 *     function runs; defensive duplicate here treats it identically.
 */
import { type IncidentPayload } from "@surakkha/shared/incident";
import { type Role } from "@surakkha/shared/rbac";

export type ActionSlot = "acknowledge" | "assign" | "submit-result" | "resolve" | "reopen" | null;

export interface IncidentCardProps {
  readonly incident: IncidentPayload;
  readonly onAction: (slot: ActionSlot) => void;
  readonly isInteractive: boolean;
}

export const actionSlotsFor = (
  incident: IncidentPayload,
  viewerRole: Role | null,
  viewerUserId: string | null = null,
): readonly ActionSlot[] => {
  if (viewerRole === null) return [];
  if (incident.state === "INSPECTING") {
    if (viewerRole !== "Technician") return [];
    return slotsForInspecting(incident.assignee_user_id, viewerUserId);
  }
  const perRole = STATE_SLOTS[incident.state];
  return perRole[viewerRole] ?? [];
};

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

const slotsForInspecting = (
  assigneeUserId: string | null,
  viewerUserId: string | null,
): readonly ActionSlot[] => {
  if (viewerUserId !== null && assigneeUserId === viewerUserId) {
    return ["submit-result"];
  }
  return [];
};
