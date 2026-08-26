/**
 * ThresholdsPage — Story 3.7 (`/admin/thresholds` admin tab).
 *
 * Three states:
 *   1. loading                       → calm "Loading…" stub.
 *   2. error                         → calm error banner with Retry.
 *   3. populated                     → table of active rules + history
 *      toggle (shows inactive versions of the same
 *      `(deviceId, metric, operator, threshold)` key) + per-row
 *      Edit / Activate / Deactivate buttons + a "New Rule" form.
 *
 * Mutations invalidate the `["admin", "thresholds", "rules"]` key
 * (handled in `useThresholds.ts`); the optimistic UI is intentionally
 * NOT applied — failures surface through toasts and the next refetch
 * restores truth. This matches the simulator admin tab's no-
 * optimistic-update pattern (`useSimulatorDevices.ts`).
 *
 * The two modals (`NewRuleModal`, `EditRuleModal`) live in
 * `ThresholdsModals.tsx`, and the populated view lives in
 * `ThresholdsPopulatedView.tsx` — both are extracted so this
 * orchestrator can stay under the lint `max-lines-per-function`
 * + `max-lines` ceilings.
 */
import { type RuleRow } from "@surakkha/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { type NewRuleForm } from "./ThresholdsModals";
import {
  ThresholdsPopulatedView,
  type ToastEntry,
  type ToastTone,
} from "./ThresholdsPopulatedView";
import {
  useActivateThreshold,
  useCreateThreshold,
  useThresholds,
  useUpdateThreshold,
} from "./useThresholds";

const TOAST_TTL_MS = 4_000;

/**
 * Compute the slot key for the history toggle. Inactive rows with
 * the same `(deviceId, metric, operator, threshold)` key as an active
 * row are surfaced in the history panel. Using a tuple key avoids
 * floating-point equality on `threshold`.
 */
const slotKey = (row: RuleRow): string =>
  `${row.deviceId ?? "global"}::${row.metric}::${row.operator}::${row.threshold.toString()}`;

export const ThresholdsPage = () => {
  const listQuery = useThresholds(false);
  const createMutation = useCreateThreshold();
  const updateMutation = useUpdateThreshold();
  const activateMutation = useActivateThreshold();
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const nextIdRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const pushToast = (tone: ToastTone, message: string): void => {
    const id = ++nextIdRef.current;
    setToasts((cur) => [...cur, { id, tone, message }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
    timersRef.current.add(timer);
  };

  // Clear any pending toast timers when the page unmounts so the
  // deferred `setToasts` callbacks don't fire on an unmounted tree.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Hooks MUST run on every render — derive the lists BEFORE any
  // early returns so the hook order is stable across the loading
  // → populated / error transitions. Wrapping `rules` in its own
  // `useMemo` keeps the `useMemo` dep arrays stable across renders
  // (otherwise the `?? []` fallback re-creates the array each
  // render, which would force `active` + `inactive` to recompute).
  const rules = useMemo<readonly RuleRow[]>(() => listQuery.data?.rules ?? [], [listQuery.data]);
  const active = useMemo(() => rules.filter((r) => r.isActive), [rules]);
  const inactive = useMemo(() => rules.filter((r) => !r.isActive), [rules]);
  const visible = showHistory ? rules : active;

  const handleDeactivate = (row: RuleRow): void => {
    updateMutation.mutate(
      { id: row.id, body: { activate: false } },
      {
        onSuccess: () => pushToast("success", "Rule deactivated."),
        onError: (err) => pushToast("error", `Deactivate failed: ${err.message}`),
      },
    );
  };

  const handleActivate = (row: RuleRow): void => {
    activateMutation.mutate(
      { id: row.id },
      {
        onSuccess: () => pushToast("success", "Rule activated."),
        onError: (err) => pushToast("error", `Activate failed: ${err.message}`),
      },
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
      {
        onSuccess: () => pushToast("success", "Rule created."),
        onError: (err) => pushToast("error", `Create failed: ${err.message}`),
      },
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

  // Loading state.
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
        <p
          className="rounded-input border px-4 py-2 text-md"
          style={{
            backgroundColor: "#FEE2E2",
            borderColor: "#7F1D1D",
            color: "#7F1D1D",
          }}
        >
          Failed to load thresholds.
        </p>
        <button
          type="button"
          data-testid="thresholds-page-retry"
          onClick={() => void listQuery.refetch()}
          className="rounded-input border px-4 py-2 text-md"
          style={{
            borderColor: "#E2E8F0",
            color: "#0F172A",
            backgroundColor: "#FFFFFF",
          }}
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
