/**
 * Modal components for the Thresholds page — Story 3.7.
 *
 * Two controlled forms (no `react-hook-form` dependency):
 *   - `NewRuleModal` — create a new Rule at v1.
 *   - `EditRuleModal` — edit-via-supersede; only `threshold` is
 *     editable today (the other Rule fields are immutable across
 *     versions by design — the `(deviceId, metric, operator,
 *     threshold)` tuple keys the supersede slot).
 *
 * Kept in their own file so `ThresholdsPage.tsx` stays under the
 * lint `max-lines-per-function` and `max-lines` ceilings.
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
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-input p-4"
        style={{ backgroundColor: "#FFFFFF" }}
      >
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
            className="rounded-input border px-3 py-1 text-md"
            style={{ borderColor: "#E2E8F0" }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="thresholds-new-rule-submit"
            onClick={() => onSubmit(form)}
            className="rounded-input border px-3 py-1 text-md"
            style={{
              borderColor: "#0F172A",
              color: "#FFFFFF",
              backgroundColor: "#0F172A",
            }}
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
      className="fixed inset-0 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-input p-4"
        style={{ backgroundColor: "#FFFFFF" }}
      >
        <h2 className="text-lg font-semibold">
          Edit rule {rule.metric} {rule.operator} {rule.threshold}
        </h2>
        <p className="text-md text-neutral-secondary">
          Editing creates a new version. The old row is deactivated automatically.
        </p>
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
            className="rounded-input border px-3 py-1 text-md"
            style={{ borderColor: "#E2E8F0" }}
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
            className="rounded-input border px-3 py-1 text-md"
            style={{
              borderColor: "#0F172A",
              color: "#FFFFFF",
              backgroundColor: "#0F172A",
            }}
          >
            Supersede
          </button>
        </div>
      </div>
    </div>
  );
};
