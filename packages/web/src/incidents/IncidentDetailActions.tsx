/**
 * Action region on the detail page (Acknowledge / Assign / Submit
 * Result / Reopen / Export CSV). Visibility gated by
 * `actionSlotsFor`; each CTA is `disabled` while its mutation is
 * in flight.
 */
import { type IncidentPayload, type InspectionOutcome } from "@surakkha/shared/incident";
import { isAllowed, type Role } from "@surakkha/shared/rbac";
import { useState } from "react";

import { actionSlotsFor } from "../components/IncidentCard.types";

import { SEEDED_TECHNICIAN_IDS } from "./seededTechnicians";

const TECH_LABEL_TAIL_LENGTH = 8;

const ACTION_BUTTON_BASE =
  "border-primary bg-primary hover:bg-primary-hover disabled:bg-primary/60 disabled:cursor-not-allowed";

/** Prop names follow `react/boolean-prop-naming` (e.g. `isAck` not
 *  `isAcknowledge`; `isSubmitting` for the submit-result mutation). */
interface IncidentDetailActionsProps {
  readonly incident: IncidentPayload;
  readonly viewerRole: Role | null;
  readonly viewerUserId: string | null;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly isSubmitting: boolean;
  readonly isReopening: boolean;
  readonly isExporting: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
  readonly onExportCsv: () => void;
}

interface SlotFlags {
  readonly canAcknowledge: boolean;
  readonly canAssign: boolean;
  readonly canSubmitResult: boolean;
  readonly canReopen: boolean;
  /** Client-side mirror of the `export Reading` RBAC matrix entry. */
  readonly canExportCsv: boolean;
}

const computeSlotFlags = (
  incident: IncidentPayload,
  viewerRole: Role | null,
  viewerUserId: string | null,
): SlotFlags => {
  const slots = actionSlotsFor(incident, viewerRole, viewerUserId);
  return {
    canAcknowledge: slots.includes("acknowledge"),
    canAssign: slots.includes("assign"),
    canSubmitResult: slots.includes("submit-result"),
    canReopen: slots.includes("reopen"),
    canExportCsv:
      viewerRole !== null &&
      isAllowed({ subject: viewerRole, action: "export", resource: "Reading" }),
  };
};

export const IncidentDetailActions = ({
  incident,
  viewerRole,
  viewerUserId,
  isAck,
  isAssign,
  isSubmitting,
  isReopening,
  isExporting,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
  onExportCsv,
}: IncidentDetailActionsProps) => {
  const flags = computeSlotFlags(incident, viewerRole, viewerUserId);
  const { canAcknowledge, canAssign, canSubmitResult, canReopen, canExportCsv } = flags;
  const anyVisible = canAcknowledge || canAssign || canSubmitResult || canReopen || canExportCsv;
  if (!anyVisible) {
    return null;
  }
  return (
    <Actions
      flags={flags}
      isAck={isAck}
      isAssign={isAssign}
      isSubmitting={isSubmitting}
      isReopening={isReopening}
      isExporting={isExporting}
      onAcknowledge={onAcknowledge}
      onAssign={onAssign}
      onSubmitResult={onSubmitResult}
      onReopen={onReopen}
      onExportCsv={onExportCsv}
    />
  );
};

interface ActionsProps {
  readonly flags: SlotFlags;
  readonly isAck: boolean;
  readonly isAssign: boolean;
  readonly isSubmitting: boolean;
  readonly isReopening: boolean;
  readonly isExporting: boolean;
  readonly onAcknowledge: () => void;
  readonly onAssign: (assigneeUserId: string) => void;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
  readonly onReopen: (reason: string) => void;
  readonly onExportCsv: () => void;
}

/** Bundled flag prop keeps the orchestrator's destructuring compact
 *  (`react/boolean-prop-naming` rejects names that don't match
 *  `^is[A-Z]...`). */
const Actions = ({
  flags,
  isAck,
  isAssign,
  isSubmitting,
  isReopening,
  isExporting,
  onAcknowledge,
  onAssign,
  onSubmitResult,
  onReopen,
  onExportCsv,
}: ActionsProps) => {
  const { canAcknowledge, canAssign, canSubmitResult, canReopen, canExportCsv } = flags;
  return (
    <div data-testid="incident-detail-actions" className="flex flex-col gap-3">
      {canAcknowledge ? (
        <button
          type="button"
          data-testid="incident-detail-acknowledge-button"
          disabled={isAck}
          onClick={onAcknowledge}
          className={[
            "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
            ACTION_BUTTON_BASE,
          ].join(" ")}
        >
          {isAck ? "Acknowledging…" : "Acknowledge"}
        </button>
      ) : null}
      {canAssign ? <AssignForm isPending={isAssign} onAssign={onAssign} /> : null}
      {canSubmitResult ? (
        <SubmitResultForm isPending={isSubmitting} onSubmitResult={onSubmitResult} />
      ) : null}
      {canReopen ? <ReopenForm isPending={isReopening} onReopen={onReopen} /> : null}
      {canExportCsv ? (
        <button
          type="button"
          data-testid="incident-detail-export-csv-button"
          disabled={isExporting}
          onClick={onExportCsv}
          className={[
            "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
            ACTION_BUTTON_BASE,
          ].join(" ")}
        >
          {isExporting ? "Exporting…" : "Export CSV (30d)"}
        </button>
      ) : null}
    </div>
  );
};

interface AssignFormProps {
  readonly isPending: boolean;
  readonly onAssign: (assigneeUserId: string) => void;
}

const AssignForm = ({ isPending, onAssign }: AssignFormProps) => {
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const canFire = selectedAssignee !== "" && !isPending;

  return (
    <div data-testid="incident-detail-assign-form" className="flex flex-col gap-2 self-start">
      <label
        className="text-xs font-medium text-neutral-secondary"
        htmlFor="incident-detail-assign-select"
      >
        Assign technician
      </label>
      <div className="flex items-center gap-2">
        {/* eslint-disable react/forbid-dom-props -- target of the sibling <label htmlFor>. */}
        <select
          id="incident-detail-assign-select"
          data-testid="incident-detail-assign-select"
          value={selectedAssignee}
          disabled={isPending}
          onChange={(e) => setSelectedAssignee(e.target.value)}
          className="rounded-input border border-neutral-border bg-neutral-surface px-3 py-2 text-sm text-neutral-body disabled:cursor-not-allowed disabled:bg-neutral-page"
        >
          <option value="" disabled>
            Select a technician…
          </option>
          {SEEDED_TECHNICIAN_IDS.map((id) => (
            <option key={id} value={id}>
              Technician {id.slice(-TECH_LABEL_TAIL_LENGTH)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="incident-detail-assign-button"
          disabled={!canFire}
          onClick={() => onAssign(selectedAssignee)}
          className={[
            "rounded-input border px-4 py-2 text-sm font-medium text-white",
            ACTION_BUTTON_BASE,
          ].join(" ")}
        >
          {isPending ? "Assigning…" : "Assign"}
        </button>
      </div>
    </div>
  );
};

const INSPECTION_OUTCOMES: readonly InspectionOutcome[] = ["SAFE", "UNSAFE", "MONITORING"];

const OUTCOME_LABEL: Readonly<Record<InspectionOutcome, string>> = {
  SAFE: "Marked safe",
  UNSAFE: "Marked unsafe",
  MONITORING: "Marked for monitoring",
};

interface SubmitResultFormProps {
  readonly isPending: boolean;
  readonly onSubmitResult: (outcome: InspectionOutcome) => void;
}

const SubmitResultForm = ({ isPending, onSubmitResult }: SubmitResultFormProps) => {
  const [selectedOutcome, setSelectedOutcome] = useState<InspectionOutcome | null>(null);
  const canFire = selectedOutcome !== null && !isPending;

  return (
    <fieldset
      data-testid="incident-detail-submit-result-form"
      disabled={isPending}
      className="flex flex-col gap-2 self-start rounded-input border border-neutral-border bg-neutral-surface p-3"
    >
      <legend className="text-xs font-medium text-neutral-secondary">Inspection result</legend>
      <div className="flex flex-col gap-1">
        {INSPECTION_OUTCOMES.map((outcome) => (
          <label
            key={outcome}
            className="flex items-center gap-2 text-sm text-neutral-body disabled:cursor-not-allowed"
          >
            <input
              type="radio"
              name="incident-detail-submit-result-outcome"
              value={outcome}
              data-testid={`incident-detail-submit-result-radio-${outcome}`}
              checked={selectedOutcome === outcome}
              disabled={isPending}
              onChange={() => setSelectedOutcome(outcome)}
              className="size-4 disabled:cursor-not-allowed"
            />
            <span>{OUTCOME_LABEL[outcome]}</span>
            <span className="text-xs text-neutral-secondary">({outcome})</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        data-testid="incident-detail-submit-result-button"
        disabled={!canFire}
        onClick={() => {
          if (selectedOutcome !== null) onSubmitResult(selectedOutcome);
        }}
        className={[
          "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
          ACTION_BUTTON_BASE,
        ].join(" ")}
      >
        {isPending ? "Submitting…" : "Submit result"}
      </button>
    </fieldset>
  );
};

const REOPEN_REASON_MIN_LENGTH = 10;
const REOPEN_REASON_MAX_LENGTH = 2000;

interface ReopenFormProps {
  readonly isPending: boolean;
  readonly onReopen: (reason: string) => void;
}

const ReopenForm = ({ isPending, onReopen }: ReopenFormProps) => {
  const [reason, setReason] = useState<string>("");
  const canFire = reason.trim().length >= REOPEN_REASON_MIN_LENGTH && !isPending;

  return (
    <fieldset
      data-testid="incident-detail-reopen-form"
      disabled={isPending}
      className="flex flex-col gap-2 self-start rounded-input border border-neutral-border bg-neutral-surface p-3"
    >
      <legend className="text-xs font-medium text-neutral-secondary">Reopen incident</legend>
      <label className="text-xs text-neutral-secondary" htmlFor="incident-detail-reopen-reason">
        Reason (required, between 10 and 2000 characters)
      </label>
      {/* eslint-disable react/forbid-dom-props -- target of the sibling <label htmlFor>. */}
      <textarea
        id="incident-detail-reopen-reason"
        data-testid="incident-detail-reopen-reason"
        value={reason}
        disabled={isPending}
        required
        aria-required="true"
        maxLength={REOPEN_REASON_MAX_LENGTH}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        className="rounded-input border border-neutral-border bg-neutral-page px-3 py-2 text-sm text-neutral-body disabled:cursor-not-allowed disabled:bg-neutral-page"
      />
      <button
        type="button"
        data-testid="incident-detail-reopen-button"
        disabled={!canFire}
        onClick={() => {
          if (canFire) onReopen(reason.trim());
        }}
        className={[
          "self-start rounded-input border px-4 py-2 text-sm font-medium text-white",
          ACTION_BUTTON_BASE,
        ].join(" ")}
      >
        {isPending ? "Reopening…" : "Reopen"}
      </button>
    </fieldset>
  );
};
