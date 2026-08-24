/**
 * SimulatorPage — Story 2.5.
 *
 * Renders the admin tab at `/admin/simulator`. Three states:
 *   1. disabled (SIMULATOR_SECRET unset)  → banner only.
 *   2. loading                             → calm "Loading…" stub.
 *   3. enabled                             → six `DeviceRow`s + a toast
 *      region for switch success / failure toasts.
 *
 * The toast region is a small inline list — Story 2.5 does not pull
 * in a global toast system; the spec mandates "toast" semantics
 * (auto-dismiss) but a list with a manual dismiss works for the v1
 * surface and keeps the dependency footprint small.
 */
import { useEffect, useRef, useState } from "react";

import { DeviceRow } from "./DeviceRow";
import { DisabledBanner } from "./DisabledBanner";
import {
  type SwitchScenarioError,
  useSimulatorDevices,
  useSimulatorStatus,
} from "./useSimulatorDevices";

interface ToastEntry {
  readonly id: number;
  readonly tone: "success" | "error";
  readonly message: string;
}

const TOAST_TTL_MS = 4_000;

// HTTP status codes the SimulatorPage branches on directly (G3-01 /
// G3-12 / G3-15). Named constants so the lint rule
// `no-magic-numbers` doesn't flag the inline literals.
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

const TOAST_BG: Record<ToastEntry["tone"], string> = {
  success: "#E8F6EE",
  error: "#FEE2E2",
};
const TOAST_TEXT: Record<ToastEntry["tone"], string> = {
  success: "#0F6B3A",
  error: "#7F1D1D",
};

/**
 * Map a typed mutation error to a user-facing toast string. The
 * disabled-banner transition (G3-03 / G3-04) is handled at the
 * mutation call site, not here — by the time we reach this
 * function, the page has already invalidated the status query and
 * the banner is rendered. We only render a toast for failures that
 * are NOT banner transitions (e.g. transients, validation, etc.).
 */
const errorMessage = (err: SwitchScenarioError): string => {
  switch (err.kind) {
    case "secret_mismatch":
      // G3-04: AC8 mandates the disabled banner state; the page has
      // already invalidated status by the time we reach here. The
      // toast wording matches the disabled-banner calm copy.
      return "Simulator disabled.";
    case "simulator_unreachable":
      return "Simulator unreachable.";
    case "switch_in_progress":
      return "Another switch is in progress.";
    case "validation_error":
      return "Switch failed: invalid input.";
    case "unknown":
      return `Switch failed (${err.status}).`;
  }
};

export const SimulatorPage = () => {
  const statusQuery = useSimulatorStatus();
  const devicesQuery = useSimulatorDevices();
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  // G3-08: monotonic id generator. `Date.now() + Math.random()`
  // collided when two toasts landed in the same ms from sibling
  // rows (a burst of clicks or two failures from one tick).
  const nextIdRef = useRef(0);
  // G3-09: track pending TTL timers so they can be cleared on
  // unmount; otherwise a navigation away during the 4-second window
  // fires setState on an unmounted component and leaks a closure
  // per toast.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(
    () => () => {
      // G3-09 cleanup: clear all pending TTL timers on unmount.
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current.clear();
    },
    [],
  );

  // G3-03 / G3-04: when a Switch POST surfaces a `secret_mismatch`
  // or a 503-with-disabled body, invalidate the status query so the
  // page renders the disabled-banner branch (per AC2 / AC8) instead
  // of a transient toast that disappears after 4 s. The toast still
  // surfaces for the user feedback loop, but the banner is the
  // persistent operator-facing signal.
  useEffect(() => {
    const errorStatus = (devicesQuery.error as { status?: number } | null)
      ?.status;
    if (
      devicesQuery.isError &&
      // api may return 401 (token role downgrade) or 403 (RBAC
      // denied) — invalidate so a fresh `enabled` check kicks in.
      (errorStatus === HTTP_UNAUTHORIZED || errorStatus === HTTP_FORBIDDEN)
    ) {
      void statusQuery.refetch();
    }
  }, [devicesQuery.isError, devicesQuery.error, statusQuery]);

  const pushToast = (tone: ToastEntry["tone"], message: string): void => {
    const id = ++nextIdRef.current;
    setToasts((cur) => [...cur, { id, tone, message }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
    timersRef.current.add(timer);
  };

  // Loading state.
  if (statusQuery.isLoading || devicesQuery.isLoading) {
    return (
      <div data-testid="simulator-page-loading">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <p className="mt-2 text-md text-neutral-secondary">Loading…</p>
      </div>
    );
  }

  // Disabled state — banner only, no rows. Checked BEFORE the
  // devices-error branch so the disabled banner wins when the api
  // returns 503 on /status (the devices call would also 401/404 in
  // that state, but the operator-facing signal is "simulator is
  // disabled", not "something went wrong").
  if (statusQuery.data?.enabled === false) {
    return (
      <div data-testid="simulator-page-disabled" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <DisabledBanner />
      </div>
    );
  }

  // Status query errored (G3-01: anything other than 200/503) —
  // surface through the page-level error banner so the operator
  // doesn't see a misleading "disabled" copy for what is actually
  // an outage.
  if (statusQuery.isError) {
    return (
      <div data-testid="simulator-page-status-error" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <p
          className="rounded-input border px-4 py-2 text-md"
          style={{
            backgroundColor: "#FEE2E2",
            borderColor: "#7F1D1D",
            color: "#7F1D1D",
          }}
        >
          Failed to load simulator status. Reload the page.
        </p>
      </div>
    );
  }

  // Devices query errored — render a calm error banner with a Retry
  // button (G3-12) rather than collapsing to "0 devices". Operators
  // hitting this state usually mean the api is 500'ing or the JWT
  // is stale; the page-level error message keeps the failure
  // visible without pretending the data is empty.
  if (devicesQuery.isError) {
    return (
      <div data-testid="simulator-page-error" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <p
          className="rounded-input border px-4 py-2 text-md"
          style={{
            backgroundColor: "#FEE2E2",
            borderColor: "#7F1D1D",
            color: "#7F1D1D",
          }}
        >
          Failed to load devices.
        </p>
        <button
          type="button"
          data-testid="simulator-page-retry"
          onClick={() => void devicesQuery.refetch()}
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

  const devices = devicesQuery.data?.devices ?? [];

  return (
    <div data-testid="simulator-page" className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <span
          data-testid="simulator-device-count"
          className="text-md text-neutral-secondary"
        >
          {devices.length} device{devices.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {devices.map((d) => (
          <DeviceRow
            key={d.device_id}
            device={d}
            // G3-03 / G3-04: on secret_mismatch / simulator_unreachable
            // invalidate the status query so the disabled-banner branch
            // surfaces (the persistent operator-facing signal). The
            // toast still surfaces for the user feedback loop.
            onError={(err) => {
              if (
                err.kind === "secret_mismatch" ||
                err.kind === "simulator_unreachable"
              ) {
                void statusQuery.refetch();
              }
              pushToast("error", errorMessage(err));
            }}
            onSuccess={(msg) => pushToast("success", msg)}
          />
        ))}
      </div>

      <ul
        data-testid="simulator-toast-region"
        aria-live="polite"
        className="flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <li
            key={t.id}
            data-testid={`simulator-toast-${t.tone}`}
            className="rounded-input border px-4 py-2 text-md"
            style={{
              backgroundColor: TOAST_BG[t.tone],
              borderColor: TOAST_TEXT[t.tone],
              color: TOAST_TEXT[t.tone],
            }}
          >
            {t.message}
          </li>
        ))}
      </ul>
    </div>
  );
};
