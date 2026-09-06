/**
 * `ThresholdsModals` — controlled forms for the Thresholds page.
 * `NewRuleModal` creates a Rule at v1; `EditRuleModal` edits via
 * supersede (only `threshold` is mutable across versions; the
 * `(deviceId, metric, operator, threshold)` tuple keys the slot).
 *
 * Modal chrome follows the dashboard's `metric-card` pattern
 * (border + 10px radius + `shadow-elevation-card`) so the panel
 * reads as a lifted card against the backdrop. The backdrop uses
 * `bg-neutral-sidebar/45` (matches the sidebar drawer overlay) so
 * the rest of the app dims in lockstep with the drawer's existing
 * behaviour. `aria-modal="true"` + `aria-labelledby` give assistive
 * tech the right semantics; an Escape-key handler closes the
 * dialog (matches the sidebar drawer UX).
 */
import { type RuleRow } from "@surakkha/shared";
import { useEffect, useState } from "react";

export interface NewRuleForm {
  deviceId: string;
  metric: RuleRow["metric"];
  operator: RuleRow["operator"];
  threshold: string;
  severity: RuleRow["severity"];
  ruleType: RuleRow["ruleType"];
  minDurationSeconds: string;
  hysteresisSeconds: string;
}

export const emptyNewRuleForm: NewRuleForm = {
  deviceId: "",
  metric: "ph",
  operator: "lt",
  threshold: "",
  severity: "warning",
  ruleType: "instant",
  minDurationSeconds: "0",
  hysteresisSeconds: "0",
};

// Shared modal chrome — the backdrop + lifted card panel. `z-50`
// sits above the sidebar drawer (`z-40`) so the dialog wins when
// both could be on screen.
const MODAL_BACKDROP_CLASS =
  "fixed inset-0 z-50 flex items-center justify-center bg-neutral-sidebar/45 p-4";
const MODAL_PANEL_CLASS =
  "flex w-full max-w-md flex-col rounded-card border border-neutral-border bg-neutral-surface shadow-elevation-card";

interface ModalHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly onClose: () => void;
  readonly closeTestId: string;
}

const ModalHeader = ({ title, subtitle, onClose, closeTestId }: ModalHeaderProps) => (
  <header className="flex items-start justify-between gap-3 border-b border-neutral-border px-4 py-3">
    <div className="min-w-0">
      <h2 className="text-xl font-bold text-neutral-body">{title}</h2>
      {subtitle !== undefined ? (
        <p className="mt-0.5 text-md text-neutral-secondary">{subtitle}</p>
      ) : null}
    </div>
    <button
      type="button"
      data-testid={closeTestId}
      aria-label="Close dialog"
      onClick={onClose}
      className="shrink-0 rounded-input px-2 py-1 text-md text-neutral-secondary hover:bg-neutral-page hover:text-neutral-body"
    >
      ×
    </button>
  </header>
);

interface FormFieldProps {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}

// Stack the label above the control with a small hint line below.
// `text-md` is the design-token form-field size (DESIGN.md
// §Typography); inputs/selects get explicit `border-neutral-border`
// so they read as outlined inputs against the white surface.
const FormField = ({ label, htmlFor, hint, children }: FormFieldProps) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={htmlFor} className="text-md font-medium text-neutral-body">
      {label}
    </label>
    {children}
    {hint !== undefined ? <span className="text-xs text-neutral-secondary">{hint}</span> : null}
  </div>
);

const FIELD_CONTROL_CLASS =
  "rounded-input border border-neutral-border bg-neutral-surface px-3 py-2 text-md text-neutral-body outline-none focus:ring-2 focus:ring-primary";

interface NewRuleModalProps {
  readonly onClose: () => void;
  readonly onSubmit: (form: NewRuleForm) => void;
}

export const NewRuleModal = ({ onClose, onSubmit }: NewRuleModalProps) => {
  const [form, setForm] = useState<NewRuleForm>(emptyNewRuleForm);

  // Escape closes the modal — matches the sidebar drawer's keyboard
  // UX (AppShell.tsx useEffect) so the dialog and the drawer feel
  // like the same modal layer to the user.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="thresholds-new-rule-modal"
      role="dialog"
      aria-modal="true"
      aria-label="New rule"
      className={MODAL_BACKDROP_CLASS}
    >
      <div className={MODAL_PANEL_CLASS}>
        <ModalHeader
          title="New Rule"
          subtitle="Create a v1 rule. Edits after creation supersede the previous version."
          onClose={onClose}
          closeTestId="thresholds-new-rule-close"
        />
        <div className="flex flex-col gap-3 p-4">
          <FormField
            label="Device ID"
            htmlFor="thresholds-new-rule-deviceId"
            hint="Blank = applies to every device."
          >
            <input
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-deviceId"
              data-testid="thresholds-new-rule-deviceId"
              value={form.deviceId}
              onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
              className={FIELD_CONTROL_CLASS}
            />
          </FormField>
          <FormField label="Metric" htmlFor="thresholds-new-rule-metric">
            <select
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-metric"
              data-testid="thresholds-new-rule-metric"
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value as RuleRow["metric"] })}
              className={FIELD_CONTROL_CLASS}
            >
              <option value="ph">ph</option>
              <option value="tds_ppm">tds_ppm</option>
              <option value="turbidity_ntu">turbidity_ntu</option>
              <option value="chlorine_ppm">chlorine_ppm</option>
              <option value="temp_c">temp_c</option>
              <option value="water_level_cm">water_level_cm</option>
            </select>
          </FormField>
          <FormField label="Operator" htmlFor="thresholds-new-rule-operator">
            <select
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-operator"
              data-testid="thresholds-new-rule-operator"
              value={form.operator}
              onChange={(e) =>
                setForm({
                  ...form,
                  operator: e.target.value as RuleRow["operator"],
                })
              }
              className={FIELD_CONTROL_CLASS}
            >
              <option value="lt">lt</option>
              <option value="lte">lte</option>
              <option value="gt">gt</option>
              <option value="gte">gte</option>
              <option value="eq">eq</option>
            </select>
          </FormField>
          <FormField label="Threshold" htmlFor="thresholds-new-rule-threshold">
            <input
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-threshold"
              data-testid="thresholds-new-rule-threshold"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              className={`${FIELD_CONTROL_CLASS} font-mono tabular-nums`}
            />
          </FormField>
          <FormField label="Severity" htmlFor="thresholds-new-rule-severity">
            <select
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-severity"
              data-testid="thresholds-new-rule-severity"
              value={form.severity}
              onChange={(e) =>
                setForm({
                  ...form,
                  severity: e.target.value as RuleRow["severity"],
                })
              }
              className={FIELD_CONTROL_CLASS}
            >
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </FormField>
          <FormField label="Rule type" htmlFor="thresholds-new-rule-ruleType">
            <select
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-ruleType"
              data-testid="thresholds-new-rule-ruleType"
              value={form.ruleType}
              onChange={(e) =>
                setForm({
                  ...form,
                  ruleType: e.target.value as RuleRow["ruleType"],
                })
              }
              className={FIELD_CONTROL_CLASS}
            >
              <option value="instant">instant</option>
              <option value="rate">rate</option>
              <option value="absence">absence</option>
            </select>
          </FormField>
          <FormField label="Min duration (s)" htmlFor="thresholds-new-rule-minDurationSeconds">
            <input
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-minDurationSeconds"
              data-testid="thresholds-new-rule-minDurationSeconds"
              value={form.minDurationSeconds}
              onChange={(e) => setForm({ ...form, minDurationSeconds: e.target.value })}
              className={`${FIELD_CONTROL_CLASS} font-mono tabular-nums`}
            />
          </FormField>
          <FormField label="Hysteresis (s)" htmlFor="thresholds-new-rule-hysteresisSeconds">
            <input
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-new-rule-hysteresisSeconds"
              data-testid="thresholds-new-rule-hysteresisSeconds"
              value={form.hysteresisSeconds}
              onChange={(e) => setForm({ ...form, hysteresisSeconds: e.target.value })}
              className={`${FIELD_CONTROL_CLASS} font-mono tabular-nums`}
            />
          </FormField>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-neutral-border px-4 py-3">
          <button
            type="button"
            data-testid="thresholds-new-rule-cancel"
            onClick={onClose}
            className="rounded-input border border-neutral-border bg-neutral-surface px-4 py-2 text-md text-neutral-body hover:bg-neutral-page"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="thresholds-new-rule-submit"
            onClick={() => onSubmit(form)}
            className="rounded-input border border-primary bg-primary px-4 py-2 text-md font-medium text-white hover:bg-primary-hover"
          >
            Create
          </button>
        </footer>
      </div>
    </div>
  );
};

export interface EditRuleRequest {
  readonly supersede: true;
  readonly threshold: number;
}

interface EditRuleModalProps {
  readonly rule: RuleRow;
  readonly onClose: () => void;
  readonly onSubmit: (body: EditRuleRequest) => void;
}

export const EditRuleModal = ({ rule, onClose, onSubmit }: EditRuleModalProps) => {
  const [threshold, setThreshold] = useState<string>(rule.threshold.toString());

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="thresholds-edit-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit rule ${rule.id}`}
      className={MODAL_BACKDROP_CLASS}
    >
      <div className={MODAL_PANEL_CLASS}>
        <ModalHeader
          title={`Edit rule · ${rule.metric} ${rule.operator} ${rule.threshold}`}
          subtitle="Editing creates a new version. The old row is deactivated automatically."
          onClose={onClose}
          closeTestId="thresholds-edit-close"
        />
        <div className="flex flex-col gap-3 p-4">
          {/* Pre-fill the rule's current fields. Only `threshold` is
              mutable (supersede key), so the rest are surfaced
              read-only — a 3-field "key identity" summary plus a
              <details> for the audit-log-only fields. Each field has
              its own data-testid for the RTL pre-fill assertions. */}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-input border border-neutral-border bg-neutral-page px-4 py-3 text-md">
            <dt className="text-neutral-secondary">Device</dt>
            <dd data-testid="thresholds-edit-field-deviceId" className="font-mono">
              {rule.deviceId ?? "global"}
            </dd>
            <dt className="text-neutral-secondary">Severity</dt>
            <dd data-testid="thresholds-edit-field-severity">{rule.severity}</dd>
            <dt className="text-neutral-secondary">Rule type</dt>
            <dd data-testid="thresholds-edit-field-ruleType">{rule.ruleType}</dd>
          </dl>
          <details
            data-testid="thresholds-edit-other-fields"
            className="rounded-input border border-neutral-border bg-neutral-page px-3 py-2 text-md"
          >
            <summary className="cursor-pointer text-neutral-secondary hover:text-neutral-body">
              More rule details
            </summary>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
              <dt className="text-neutral-secondary">Metric</dt>
              <dd data-testid="thresholds-edit-field-metric">{rule.metric}</dd>
              <dt className="text-neutral-secondary">Operator</dt>
              <dd data-testid="thresholds-edit-field-operator">{rule.operator}</dd>
              <dt className="text-neutral-secondary">Min duration (s)</dt>
              <dd
                data-testid="thresholds-edit-field-minDurationSeconds"
                className="font-mono tabular-nums"
              >
                {rule.minDurationSeconds}
              </dd>
              <dt className="text-neutral-secondary">Hysteresis (s)</dt>
              <dd
                data-testid="thresholds-edit-field-hysteresisSeconds"
                className="font-mono tabular-nums"
              >
                {rule.hysteresisSeconds}
              </dd>
            </dl>
          </details>
          <FormField label="New threshold" htmlFor="thresholds-edit-threshold">
            <input
              // eslint-disable-next-line react/forbid-dom-props -- id is required by `htmlFor` on the wrapping <label> (HTML form spec).
              id="thresholds-edit-threshold"
              data-testid="thresholds-edit-threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={`${FIELD_CONTROL_CLASS} font-mono tabular-nums`}
            />
          </FormField>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-neutral-border px-4 py-3">
          <button
            type="button"
            data-testid="thresholds-edit-cancel"
            onClick={onClose}
            className="rounded-input border border-neutral-border bg-neutral-surface px-4 py-2 text-md text-neutral-body hover:bg-neutral-page"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="thresholds-edit-submit"
            onClick={() => {
              const next = Number(threshold);
              if (Number.isNaN(next)) return;
              onSubmit({ supersede: true, threshold: next });
            }}
            className="rounded-input border border-primary bg-primary px-4 py-2 text-md font-medium text-white hover:bg-primary-hover"
          >
            Supersede
          </button>
        </footer>
      </div>
    </div>
  );
};
