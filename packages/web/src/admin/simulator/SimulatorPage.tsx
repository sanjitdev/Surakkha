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
import { useState } from "react";

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

const TOAST_BG: Record<ToastEntry["tone"], string> = {
  success: "#E8F6EE",
  error: "#FEE2E2",
};
const TOAST_TEXT: Record<ToastEntry["tone"], string> = {
  success: "#0F6B3A",
  error: "#7F1D1D",
};

const errorMessage = (err: SwitchScenarioError): string => {
  switch (err.kind) {
    case "secret_mismatch":
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

  const pushToast = (tone: ToastEntry["tone"], message: string): void => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, tone, message }]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
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

  // Devices query errored — render a calm error banner rather than
  // collapsing to "0 devices". Operators hitting this state usually
  // mean the api is 500'ing or the JWT is stale; the page-level
  // error message keeps the failure visible without pretending the
  // data is empty.
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
          Failed to load devices. Reload the page.
        </p>
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
            onError={(err) => pushToast("error", errorMessage(err))}
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
