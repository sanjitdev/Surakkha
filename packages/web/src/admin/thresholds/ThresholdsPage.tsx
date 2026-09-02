/**
 * `ThresholdsPage` — admin tab at `/admin/thresholds`. Three states:
 * loading, error, or populated (table of active rules + history
 * toggle + per-row Edit / Activate / Deactivate + New Rule form).
 *
 * Mutations invalidate the `["admin", "thresholds", "rules"]` key;
 * no optimistic UI — failures surface through toasts and the next
 * refetch restores truth.
 */
import { type RuleRow } from "@surakkha/shared";
import { useMemo, useState } from "react";

import { useToasts } from "../../incidents/toast";

import { type NewRuleForm } from "./ThresholdsModals";
import { ThresholdsPopulatedView } from "./ThresholdsPopulatedView";
import {
  useActivateThreshold,
  useCreateThreshold,
  useThresholds,
  useUpdateThreshold,
} from "./useThresholds";

/** Tuple key for the history-toggle slot. Inactive rows with the same
 *  `(deviceId, metric, operator, threshold)` key as an active row are
 *  surfaced in the history panel. String avoids float equality on
 *  `threshold`. */
const slotKey = (row: RuleRow): string =>
  `${row.deviceId ?? "global"}::${row.metric}::${row.operator}::${row.threshold.toString()}`;

/** Wire one mutation's success / error to a toast. The success
 *  message is a constant; the error is prefixed for context. */
const onMutation = (
  pushToast: (tone: "success" | "error", msg: string) => void,
  successMsg: string,
  errorPrefix: string,
) => ({
  onSuccess: () => pushToast("success", successMsg),
  onError: (err: Error) => pushToast("error", `${errorPrefix}: ${err.message}`),
});

export const ThresholdsPage = () => {
  const listQuery = useThresholds(false);
  const createMutation = useCreateThreshold();
  const updateMutation = useUpdateThreshold();
  const activateMutation = useActivateThreshold();
  const { toasts, pushToast } = useToasts();
  const [showHistory, setShowHistory] = useState(false);

  // Hooks MUST run on every render — derive the lists BEFORE any
  // early returns so the hook order is stable across the loading
  // → populated / error transitions.
  const rules = useMemo<readonly RuleRow[]>(() => listQuery.data?.rules ?? [], [listQuery.data]);
  const active = useMemo(() => rules.filter((r) => r.isActive), [rules]);
  const inactive = useMemo(() => rules.filter((r) => !r.isActive), [rules]);
  const visible = showHistory ? rules : active;

  const handleDeactivate = (row: RuleRow): void => {
    updateMutation.mutate(
      { id: row.id, body: { activate: false } },
      onMutation(pushToast, "Rule deactivated.", "Deactivate failed"),
    );
  };

  const handleActivate = (row: RuleRow): void => {
    activateMutation.mutate(
      { id: row.id },
      onMutation(pushToast, "Rule activated.", "Activate failed"),
    );
  };

  const handleCreate = (form: NewRuleForm): void => {
    const thresholdNum = Number(form.threshold);
    const minDurationNum = Number(form.minDurationSeconds);
    const hysteresisNum = Number(form.hysteresisSeconds);
    if (Number.isNaN(thresholdNum) || Number.isNaN(minDurationNum) || Number.isNaN(hysteresisNum)) {
      pushToast("error", "Invalid numeric field.");
      return;
    }
    createMutation.mutate(
      {
        deviceId: form.deviceId === "" ? null : form.deviceId,
        metric: form.metric,
        operator: form.operator,
        threshold: thresholdNum,
        severity: form.severity,
        ruleType: form.ruleType,
        minDurationSeconds: minDurationNum,
        hysteresisSeconds: hysteresisNum,
      },
      onMutation(pushToast, "Rule created.", "Create failed"),
    );
  };

  const handleSupersede = (id: string, threshold: number): void => {
    updateMutation.mutate(
      { id, body: { supersede: true, threshold } },
      {
        onSuccess: (result) => {
          const msg =
            result.kind === "supersede"
              ? `Rule superseded (v${result.next.version}).`
              : "Rule deactivated.";
          pushToast("success", msg);
        },
        onError: (err) => pushToast("error", `Update failed: ${err.message}`),
      },
    );
  };

  if (listQuery.isLoading) {
    return (
      <div data-testid="thresholds-page-loading">
        <h1 className="text-2xl font-semibold text-neutral-body">Thresholds</h1>
        <p className="mt-2 text-md text-neutral-secondary">Loading…</p>
      </div>
    );
  }

  if (listQuery.isError) {
    return (
      <div data-testid="thresholds-page-error" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Thresholds</h1>
        <p className="rounded-input border border-severity-critical-value bg-severity-critical-bg px-4 py-2 text-md text-severity-critical-text">
          Failed to load thresholds.
        </p>
        <button
          type="button"
          data-testid="thresholds-page-retry"
          onClick={() => void listQuery.refetch()}
          className="rounded-input border border-neutral-border bg-neutral-surface px-4 py-2 text-md text-neutral-body"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <ThresholdsPopulatedView
      visible={visible}
      activeCount={active.length}
      inactiveCount={inactive.length}
      isShown={showHistory}
      onToggleHistory={setShowHistory}
      toasts={toasts}
      slotKeyFn={slotKey}
      onCreate={handleCreate}
      onSupersede={handleSupersede}
      onDeactivate={handleDeactivate}
      onActivate={handleActivate}
    />
  );
};
