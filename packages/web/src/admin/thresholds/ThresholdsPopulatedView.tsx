/**
 * `ThresholdsPopulatedView` — table + history summary + modals for
 * the Thresholds page. Extracted so the orchestrator stays under
 * the lint `max-lines-per-function` ceiling.
 */
import { type RuleRow } from "@surakkha/shared";
import { useState } from "react";

import { PageHeader } from "../../components/PageHeader";
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
  <tr
    data-testid={`thresholds-row-${row.id}`}
    data-slot-key={slotKeyFn(row)}
    className="border-b border-neutral-border text-md text-neutral-body last:border-b-0 hover:bg-neutral-page"
  >
    <td className="px-4 py-3">{row.deviceId ?? "global"}</td>
    <td className="px-4 py-3 font-mono tabular-nums">{row.metric}</td>
    <td className="px-4 py-3 font-mono tabular-nums">{row.operator}</td>
    <td className="px-4 py-3 font-mono tabular-nums">{row.threshold}</td>
    <td className="px-4 py-3">{row.severity}</td>
    <td className="px-4 py-3 font-mono tabular-nums">{row.version}</td>
    <td className="px-4 py-3">{row.isActive ? "yes" : "no"}</td>
    <td className="px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`thresholds-edit-${row.id}`}
          onClick={() => onEdit(row)}
          className="rounded-input border border-neutral-border bg-neutral-surface px-3 py-1 text-md text-neutral-body hover:bg-neutral-page"
        >
          Edit
        </button>
        {row.isActive ? (
          <button
            type="button"
            data-testid={`thresholds-deactivate-${row.id}`}
            onClick={() => onDeactivate(row)}
            className="rounded-input border border-neutral-border bg-neutral-surface px-3 py-1 text-md text-neutral-body hover:bg-neutral-page"
          >
            Deactivate
          </button>
        ) : (
          <button
            type="button"
            data-testid={`thresholds-activate-${row.id}`}
            onClick={() => onActivate(row)}
            className="rounded-input border border-primary bg-primary px-3 py-1 text-md font-medium text-white hover:bg-primary-hover"
          >
            Activate
          </button>
        )}
      </div>
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
      <PageHeader
        title="Thresholds"
        actions={
          <>
            <span
              data-testid="thresholds-active-count"
              className="rounded-pill bg-neutral-page px-2 py-0.5 text-md text-neutral-secondary"
            >
              {activeCount} active
            </span>
            <label className="flex items-center gap-2 text-md text-neutral-secondary">
              <input
                type="checkbox"
                data-testid="thresholds-show-history"
                checked={isShown}
                onChange={(e) => onToggleHistory(e.target.checked)}
                // The Tailwind spacing-scale replacement in
                // `tailwind.config.ts` strips `size-*` / `w-*` /
                // `h-*` utilities; use inline dimensions to keep the
                // checkbox tap target readable.
                style={{ width: "16px", height: "16px" }}
              />
              <span>Show history</span>
            </label>
            <button
              type="button"
              data-testid="thresholds-new-rule"
              onClick={() => setCreating(true)}
              className="rounded-input border border-primary bg-primary px-4 py-2 text-md font-medium text-white hover:bg-primary-hover"
            >
              New Rule
            </button>
          </>
        }
      />

      {/* `metric-card rounded-card border border-neutral-border
          bg-neutral-surface shadow-elevation-card` matches the
          dashboard region's chrome (see RegionCard.tsx). The table
          inside uses `border-collapse` with explicit
          `border-neutral-border` row separators + `last:border-b-0`
          on the final row so the bottom edge of the table aligns
          with the card's `rounded-card` radius without an extra
          stray line. */}
      <section
        data-testid="thresholds-table-card"
        aria-label="Active threshold rules"
        className="metric-card rounded-card border border-neutral-border bg-neutral-surface p-0 shadow-elevation-card"
      >
        <table data-testid="thresholds-table" className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-border bg-neutral-page text-xs uppercase tracking-wider text-neutral-secondary">
              <th className="px-4 py-2 text-left font-semibold">Device</th>
              <th className="px-4 py-2 text-left font-semibold">Metric</th>
              <th className="px-4 py-2 text-left font-semibold">Operator</th>
              <th className="px-4 py-2 text-left font-semibold">Threshold</th>
              <th className="px-4 py-2 text-left font-semibold">Severity</th>
              <th className="px-4 py-2 text-left font-semibold">Version</th>
              <th className="px-4 py-2 text-left font-semibold">Active</th>
              <th className="px-4 py-2 text-left font-semibold">Actions</th>
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
                  className="px-4 py-8 text-center text-md text-neutral-secondary"
                >
                  No thresholds yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

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
