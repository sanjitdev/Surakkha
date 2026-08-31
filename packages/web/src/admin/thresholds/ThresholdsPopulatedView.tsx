/**
 * The populated view for the Thresholds page — Story 3.7.
 *
 * Extracted from `ThresholdsPage.tsx` so the orchestrator can stay
 * under the lint `max-lines-per-function` + `max-lines` ceilings.
 * All the JSX for the populated branch + the row renderer + the
 * header / table / history summary / toast region / modals live
 * here.
 *
 * The two modals (`NewRuleModal`, `EditRuleModal`) live in
 * `ThresholdsModals.tsx`. The toast types + region are shared from
 * `incidents/toast.tsx` (Epic-6 sweep); see `toast.tsx` for the
 * `testIdPrefix` convention used below.
 */
import { type RuleRow } from "@surakkha/shared";
import { useState } from "react";

import { type ToastEntry, ToastRegion } from "../../incidents/toast";

import { EditRuleModal, type NewRuleForm, NewRuleModal } from "./ThresholdsModals";

interface RuleRowRendererProps {
  readonly row: RuleRow;
  readonly slotKeyFn: (row: RuleRow) => string;
  readonly onEdit: (row: RuleRow) => void;
  readonly onDeactivate: (row: RuleRow) => void;
  readonly onActivate: (row: RuleRow) => void;
}

const RuleRowRenderer = ({
  row,
  slotKeyFn,
  onEdit,
  onDeactivate,
  onActivate,
}: RuleRowRendererProps) => (
  <tr data-testid={`thresholds-row-${row.id}`} data-slot-key={slotKeyFn(row)}>
    <td className="border-b px-2 py-1">{row.deviceId ?? "global"}</td>
    <td className="border-b px-2 py-1">{row.metric}</td>
    <td className="border-b px-2 py-1">{row.operator}</td>
    <td className="border-b px-2 py-1">{row.threshold}</td>
    <td className="border-b px-2 py-1">{row.severity}</td>
    <td className="border-b px-2 py-1">{row.version}</td>
    <td className="border-b px-2 py-1">{row.isActive ? "yes" : "no"}</td>
    <td className="border-b px-2 py-1">
      <button
        type="button"
        data-testid={`thresholds-edit-${row.id}`}
        onClick={() => onEdit(row)}
        className="mr-2 rounded-input border border-neutral-border px-2 py-1 text-sm"
      >
        Edit
      </button>
      {row.isActive ? (
        <button
          type="button"
          data-testid={`thresholds-deactivate-${row.id}`}
          onClick={() => onDeactivate(row)}
          className="rounded-input border border-neutral-border px-2 py-1 text-sm"
        >
          Deactivate
        </button>
      ) : (
        <button
          type="button"
          data-testid={`thresholds-activate-${row.id}`}
          onClick={() => onActivate(row)}
          className="rounded-input border border-neutral-border px-2 py-1 text-sm"
        >
          Activate
        </button>
      )}
    </td>
  </tr>
);

interface ThresholdsPopulatedViewProps {
  readonly visible: readonly RuleRow[];
  readonly activeCount: number;
  readonly inactiveCount: number;
  readonly isShown: boolean;
  readonly onToggleHistory: (next: boolean) => void;
  readonly toasts: readonly ToastEntry[];
  readonly slotKeyFn: (row: RuleRow) => string;
  readonly onCreate: (form: NewRuleForm) => void;
  readonly onSupersede: (id: string, threshold: number) => void;
  readonly onDeactivate: (row: RuleRow) => void;
  readonly onActivate: (row: RuleRow) => void;
}

export const ThresholdsPopulatedView = ({
  visible,
  activeCount,
  inactiveCount,
  isShown,
  onToggleHistory,
  toasts,
  slotKeyFn,
  onCreate,
  onSupersede,
  onDeactivate,
  onActivate,
}: ThresholdsPopulatedViewProps) => {
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreateSubmit = (form: NewRuleForm): void => {
    onCreate(form);
    setCreating(false);
  };

  return (
    <div data-testid="thresholds-page" className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-body">Thresholds</h1>
        <div className="flex items-center gap-3">
          <span data-testid="thresholds-active-count" className="text-md text-neutral-secondary">
            {activeCount} active
          </span>
          <label className="text-md text-neutral-secondary">
            <input
              type="checkbox"
              data-testid="thresholds-show-history"
              checked={isShown}
              onChange={(e) => onToggleHistory(e.target.checked)}
            />
            <span className="ml-1">Show history</span>
          </label>
          <button
            type="button"
            data-testid="thresholds-new-rule"
            onClick={() => setCreating(true)}
            className="rounded-input border border-primary bg-primary px-4 py-2 text-md font-medium text-white hover:bg-primary-hover"
          >
            New Rule
          </button>
        </div>
      </header>

      <table data-testid="thresholds-table" className="w-full border-collapse bg-neutral-surface">
        <thead>
          <tr>
            <th className="border-b px-2 py-1 text-left">Device</th>
            <th className="border-b px-2 py-1 text-left">Metric</th>
            <th className="border-b px-2 py-1 text-left">Operator</th>
            <th className="border-b px-2 py-1 text-left">Threshold</th>
            <th className="border-b px-2 py-1 text-left">Severity</th>
            <th className="border-b px-2 py-1 text-left">Version</th>
            <th className="border-b px-2 py-1 text-left">Active</th>
            <th className="border-b px-2 py-1 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <RuleRowRenderer
              key={row.id}
              row={row}
              slotKeyFn={slotKeyFn}
              onEdit={setEditing}
              onDeactivate={onDeactivate}
              onActivate={onActivate}
            />
          ))}
          {visible.length === 0 ? (
            <tr>
              <td
                colSpan={8}
                data-testid="thresholds-empty"
                className="border-b px-2 py-4 text-center text-neutral-secondary"
              >
                No thresholds yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {isShown && inactiveCount > 0 ? (
        <p data-testid="thresholds-history-summary" className="text-md text-neutral-secondary">
          {inactiveCount} inactive version{inactiveCount === 1 ? "" : "s"} in history.
        </p>
      ) : null}

      <ToastRegion toasts={toasts} testIdPrefix="thresholds-toast" isId={false} />

      {creating ? (
        <NewRuleModal onClose={() => setCreating(false)} onSubmit={handleCreateSubmit} />
      ) : null}

      {editing ? (
        <EditRuleModal
          rule={editing}
          onClose={() => setEditing(null)}
          onSubmit={(body) => {
            setEditing(null);
            onSupersede(editing.id, body.threshold);
          }}
        />
      ) : null}
    </div>
  );
};
