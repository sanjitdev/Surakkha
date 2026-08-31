/**
 * SimulatorPage — Story 2.5.
 *
 * Renders the admin tab at `/admin/simulator`. Three states:
 *   1. disabled (SIMULATOR_SECRET unset)  → banner only.
 *   2. loading                             → calm "Loading…" stub.
 *   3. enabled                             → six `DeviceRow`s + a toast
 *      region for switch success / failure toasts.
 *
 * The toast types + region are shared from `incidents/toast.tsx`
 * (Epic-6 sweep); see `toast.tsx` for the `testIdPrefix` convention
 * used below.
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

// HTTP status codes the SimulatorPage branches on directly (G3-01 /
// G3-12 / G3-15). Named constants so the lint rule
// `no-magic-numbers` doesn't flag the inline literals.
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

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
  const { toasts, pushToast } = useToasts();

  // G3-03 / G3-04: when a Switch POST surfaces a `secret_mismatch`
  // or a 503-with-disabled body, invalidate the status query so the
  // page renders the disabled-banner branch (per AC2 / AC8) instead
  // of a transient toast that disappears after 4 s. The toast still
  // surfaces for the user feedback loop, but the banner is the
  // persistent operator-facing signal.
  useEffect(() => {
    const errorStatus = (devicesQuery.error as { status?: number } | null)?.status;
    if (
      devicesQuery.isError &&
      // api may return 401 (token role downgrade) or 403 (RBAC
      // denied) — invalidate so a fresh `enabled` check kicks in.
      (errorStatus === HTTP_UNAUTHORIZED || errorStatus === HTTP_FORBIDDEN)
    ) {
      void statusQuery.refetch();
    }
  }, [devicesQuery.isError, devicesQuery.error, statusQuery]);

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
        <p className="rounded-input border border-severity-critical-value bg-severity-critical-bg px-4 py-2 text-md text-severity-critical-text">
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
            // G3-03 / G3-04: on secret_mismatch / simulator_unreachable
            // invalidate the status query so the disabled-banner branch
            // surfaces (the persistent operator-facing signal). The
            // toast still surfaces for the user feedback loop.
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
