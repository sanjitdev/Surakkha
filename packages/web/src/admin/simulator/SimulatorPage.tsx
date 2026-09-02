/**
 * `SimulatorPage` — admin tab at `/admin/simulator`. Renders one of
 * four states: loading, disabled (SIMULATOR_SECRET unset), status
 * error, devices error, or populated (six `DeviceRow`s + toast
 * region for switch success / failure toasts).
 */
import { useEffect } from "react";

import { ToastRegion, useToasts } from "../../incidents/toast";

import { DeviceRow } from "./DeviceRow";
import { DisabledBanner } from "./DisabledBanner";
import {
  type SwitchScenarioError,
  useSimulatorDevices,
  useSimulatorStatus,
} from "./useSimulatorDevices";

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** Map a typed mutation error to a user-facing toast string. The
 *  disabled-banner transition is handled at the call site (the page
 *  invalidates the status query before this runs), so this only
 *  renders toasts for non-banner failures. */
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
  const { toasts, pushToast } = useToasts();

  // When the devices query 401s/403s (token role downgrade or RBAC
  // denial), invalidate the status query so a fresh `enabled` check
  // kicks in and the disabled banner wins over the devices error.
  useEffect(() => {
    const errorStatus = (devicesQuery.error as { status?: number } | null)?.status;
    if (
      devicesQuery.isError &&
      (errorStatus === HTTP_UNAUTHORIZED || errorStatus === HTTP_FORBIDDEN)
    ) {
      void statusQuery.refetch();
    }
  }, [devicesQuery.isError, devicesQuery.error, statusQuery]);

  if (statusQuery.isLoading || devicesQuery.isLoading) {
    return (
      <div data-testid="simulator-page-loading">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <p className="mt-2 text-md text-neutral-secondary">Loading…</p>
      </div>
    );
  }

  if (statusQuery.data?.enabled === false) {
    return (
      <div data-testid="simulator-page-disabled" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <DisabledBanner />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div data-testid="simulator-page-status-error" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <p className="rounded-input border border-severity-critical-value bg-severity-critical-bg px-4 py-2 text-md text-severity-critical-text">
          Failed to load simulator status. Reload the page.
        </p>
      </div>
    );
  }

  if (devicesQuery.isError) {
    return (
      <div data-testid="simulator-page-error" className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-neutral-body">Simulator</h1>
        <p className="rounded-input border border-severity-critical-value bg-severity-critical-bg px-4 py-2 text-md text-severity-critical-text">
          Failed to load devices.
        </p>
        <button
          type="button"
          data-testid="simulator-page-retry"
          onClick={() => void devicesQuery.refetch()}
          className="rounded-input border border-neutral-border bg-neutral-surface px-4 py-2 text-md text-neutral-body"
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
        <span data-testid="simulator-device-count" className="text-md text-neutral-secondary">
          {devices.length} device{devices.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {devices.map((d) => (
          <DeviceRow
            key={d.device_id}
            device={d}
            onError={(err) => {
              if (err.kind === "secret_mismatch" || err.kind === "simulator_unreachable") {
                void statusQuery.refetch();
              }
              pushToast("error", errorMessage(err));
            }}
            onSuccess={(msg) => pushToast("success", msg)}
          />
        ))}
      </div>

      <ToastRegion toasts={toasts} testIdPrefix="simulator-toast" isId={false} />
    </div>
  );
};
