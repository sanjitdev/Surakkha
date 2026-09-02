/**
 * `ThresholdsModals` — controlled forms for the Thresholds page.
 * `NewRuleModal` creates a Rule at v1; `EditRuleModal` edits via
 * supersede (only `threshold` is mutable across versions; the
 * `(deviceId, metric, operator, threshold)` tuple keys the slot).
 */
import { type RuleRow } from "@surakkha/shared";
import { useState } from "react";

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

interface NewRuleModalProps {
  readonly onClose: () => void;
  readonly onSubmit: (form: NewRuleForm) => void;
}

export const NewRuleModal = ({ onClose, onSubmit }: NewRuleModalProps) => {
  const [form, setForm] = useState<NewRuleForm>(emptyNewRuleForm);
  return (
    <div
      data-testid="thresholds-new-rule-modal"
      role="dialog"
      aria-label="New rule"
      className="fixed inset-0 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-input bg-neutral-surface p-4">
        <h2 className="text-lg font-semibold">New Rule</h2>
        <label className="text-md">
          Device ID (blank = global)
          <input
            data-testid="thresholds-new-rule-deviceId"
            value={form.deviceId}
            onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
            className="ml-2 rounded-input border px-2 py-1"
          />
        </label>
        <label className="text-md">
          Metric
          <select
            data-testid="thresholds-new-rule-metric"
            value={form.metric}
            onChange={(e) => setForm({ ...form, metric: e.target.value as RuleRow["metric"] })}
            className="ml-2 rounded-input border px-2 py-1"
          >
            <option value="ph">ph</option>
            <option value="tds_ppm">tds_ppm</option>
            <option value="turbidity_ntu">turbidity_ntu</option>
            <option value="chlorine_ppm">chlorine_ppm</option>
            <option value="temp_c">temp_c</option>
            <option value="water_level_cm">water_level_cm</option>
          </select>
        </label>
        <label className="text-md">
          Operator
          <select
            data-testid="thresholds-new-rule-operator"
            value={form.operator}
            onChange={(e) =>
              setForm({
                ...form,
                operator: e.target.value as RuleRow["operator"],
              })
            }
            className="ml-2 rounded-input border px-2 py-1"
          >
            <option value="lt">lt</option>
            <option value="lte">lte</option>
            <option value="gt">gt</option>
            <option value="gte">gte</option>
            <option value="eq">eq</option>
          </select>
        </label>
        <label className="text-md">
          Threshold
          <input
            data-testid="thresholds-new-rule-threshold"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            className="ml-2 rounded-input border px-2 py-1"
          />
        </label>
        <label className="text-md">
          Severity
          <select
            data-testid="thresholds-new-rule-severity"
            value={form.severity}
            onChange={(e) =>
              setForm({
                ...form,
                severity: e.target.value as RuleRow["severity"],
              })
            }
            className="ml-2 rounded-input border px-2 py-1"
          >
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label className="text-md">
          Rule type
          <select
            data-testid="thresholds-new-rule-ruleType"
            value={form.ruleType}
            onChange={(e) =>
              setForm({
                ...form,
                ruleType: e.target.value as RuleRow["ruleType"],
              })
            }
            className="ml-2 rounded-input border px-2 py-1"
          >
            <option value="instant">instant</option>
            <option value="rate">rate</option>
            <option value="absence">absence</option>
          </select>
        </label>
        <label className="text-md">
          Min duration (s)
          <input
            data-testid="thresholds-new-rule-minDurationSeconds"
            value={form.minDurationSeconds}
            onChange={(e) => setForm({ ...form, minDurationSeconds: e.target.value })}
            className="ml-2 rounded-input border px-2 py-1"
          />
        </label>
        <label className="text-md">
          Hysteresis (s)
          <input
            data-testid="thresholds-new-rule-hysteresisSeconds"
            value={form.hysteresisSeconds}
            onChange={(e) => setForm({ ...form, hysteresisSeconds: e.target.value })}
            className="ml-2 rounded-input border px-2 py-1"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="thresholds-new-rule-cancel"
            onClick={onClose}
            className="rounded-input border border-neutral-border px-3 py-1 text-md"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="thresholds-new-rule-submit"
            onClick={() => onSubmit(form)}
            className="rounded-input border border-primary bg-primary px-3 py-1 text-md text-white hover:bg-primary-hover"
          >
            Create
          </button>
        </div>
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
  return (
    <div
      data-testid="thresholds-edit-modal"
      role="dialog"
      aria-label={`Edit rule ${rule.id}`}
      className="fixed inset-0 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-input bg-neutral-surface p-4">
        <h2 className="text-lg font-semibold">
          Edit rule {rule.metric} {rule.operator} {rule.threshold}
        </h2>
        <p className="text-md text-neutral-secondary">
          Editing creates a new version. The old row is deactivated automatically.
        </p>
        {/* Spec AC8: pre-fill the rule's current fields. Only
            `threshold` is mutable (supersede key), so the rest are
            surfaced read-only — a 3-field "key identity" summary
            plus a <details> for the audit-log-only fields. Each
            field has its own data-testid for the RTL pre-fill
            assertions. */}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-md">
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
          <summary className="cursor-pointer text-neutral-secondary">More rule details</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-neutral-secondary">Metric</dt>
            <dd data-testid="thresholds-edit-field-metric">{rule.metric}</dd>
            <dt className="text-neutral-secondary">Operator</dt>
            <dd data-testid="thresholds-edit-field-operator">{rule.operator}</dd>
            <dt className="text-neutral-secondary">Min duration (s)</dt>
            <dd data-testid="thresholds-edit-field-minDurationSeconds">
              {rule.minDurationSeconds}
            </dd>
            <dt className="text-neutral-secondary">Hysteresis (s)</dt>
            <dd data-testid="thresholds-edit-field-hysteresisSeconds">{rule.hysteresisSeconds}</dd>
          </dl>
        </details>
        <label className="text-md">
          New threshold
          <input
            data-testid="thresholds-edit-threshold"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="ml-2 rounded-input border px-2 py-1"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="thresholds-edit-cancel"
            onClick={onClose}
            className="rounded-input border border-neutral-border px-3 py-1 text-md"
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
            className="rounded-input border border-primary bg-primary px-3 py-1 text-md text-white hover:bg-primary-hover"
          >
            Supersede
          </button>
        </div>
      </div>
    </div>
  );
};
