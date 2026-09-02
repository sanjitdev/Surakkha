/**
 * `DeviceRow` — one row per simulator device. Renders name + UUID,
 * the current scenario badge, a scenario `<select>` (the seven
 * `SCENARIO_NAMES`), a Switch button, and a Start / Pause toggle.
 * Disabled while the row's mutation is in flight.
 */
import { SCENARIO_NAMES } from "@surakkha/shared/simulator";
import { useEffect, useState } from "react";

import {
  type SimulatorDevice,
  type SwitchScenarioError,
  useSwitchScenario,
} from "./useSimulatorDevices";

export interface DeviceRowProps {
  readonly device: SimulatorDevice;
  readonly onError: (err: SwitchScenarioError) => void;
  readonly onSuccess: (msg: string) => void;
}

export const DeviceRow = ({ device, onError, onSuccess }: DeviceRowProps) => {
  const [selected, setSelected] = useState<string>(() => device.scenario ?? "Normal");
  const [paused, setPaused] = useState(false);
  const mutation = useSwitchScenario();

  const { isPending } = mutation;

  // G3-16: re-sync `selected` to the device's authoritative
  // scenario when the parent invalidates the device list. Without
  // this, a stale `selected` ("TurbiditySpike") could disagree with
  // the badge ("RisingTDS") after a successful Switch from another
  // admin tab, and a Switch click would re-POST a no-op scenario.
  useEffect(() => {
    setSelected(device.scenario ?? "Normal");
  }, [device.device_id, device.scenario]);

  const submit = (
    body: { scenario?: string; paused?: boolean },
    overrides?: {
      readonly onSuccess?: () => void;
      readonly onError?: (err: SwitchScenarioError) => void;
    },
  ): void => {
    // G3-14: bundle `paused` with a scenario switch so the device
    // can't end up "stuck paused" after a scenario change.
    // Previously the Switch button only posted `{ scenario }`,
    // leaving the prior `paused` value authoritative.
    const merged: { scenario?: string; paused?: boolean } = { ...body };
    if (body.scenario !== undefined && body.paused === undefined) {
      merged.paused = paused;
    }
    // No-op short-circuit: if both scenario and paused match the
    // current state, skip the POST (audit-log noise + a useless
    // 200 round trip).
    const noChange =
      (merged.scenario === undefined || merged.scenario === device.scenario) &&
      (merged.paused === undefined ||
        (merged.paused === false && paused === false) ||
        (merged.paused === true && paused === true));
    if (noChange) {
      return;
    }
    mutation.mutate(
      { deviceId: device.device_id, ...merged },
      {
        onSuccess: () => {
          if (body.scenario !== undefined) {
            onSuccess(`Switched to ${body.scenario}.`);
          } else if (body.paused === true) {
            onSuccess("Paused.");
          } else if (body.paused === false) {
            onSuccess("Resumed.");
          }
          overrides?.onSuccess?.();
        },
        onError: (err: SwitchScenarioError) => {
          onError(err);
          overrides?.onError?.(err);
        },
      },
    );
  };

  return (
    <article
      data-testid={`simulator-row-${device.device_id}`}
      className="rounded-card border border-neutral-border bg-neutral-surface p-4"
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2
            className="text-md font-semibold text-neutral-body"
            data-testid={`simulator-row-name-${device.device_id}`}
          >
            {device.name ?? "Unnamed device"}
          </h2>
          <p
            className="truncate text-sm text-neutral-secondary"
            data-testid={`simulator-row-id-${device.device_id}`}
            title={device.device_id}
          >
            {device.device_id}
          </p>
        </div>
        <span
          data-testid={`simulator-row-scenario-${device.device_id}`}
          className="rounded-pill bg-severity-healthy-bg px-3 py-1 text-sm font-medium text-severity-healthy-text"
        >
          {device.scenario ?? "Unknown"}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-secondary">Switch to scenario</span>
          <select
            data-testid={`simulator-row-select-${device.device_id}`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={isPending}
            className="rounded-input border border-neutral-border bg-neutral-surface px-3 py-2 text-md text-neutral-body"
          >
            {SCENARIO_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="button"
            data-testid={`simulator-row-switch-${device.device_id}`}
            onClick={() => submit({ scenario: selected })}
            disabled={isPending}
            className="min-h-touch rounded-input bg-primary px-4 py-2 text-md font-medium text-white hover:bg-primary-hover"
          >
            {isPending ? "Switching…" : "Switch"}
          </button>
          <button
            type="button"
            data-testid={`simulator-row-pause-${device.device_id}`}
            onClick={() => {
              const next = !paused;
              // The toggle is deferred to the mutation's onSuccess
              // callback so a failed POST does NOT flip the local
              // `paused` state (P2 regression). The parent's toast
              // callbacks are already wired by `submit`'s default
              // path — `overrides` here only adds the local-state
              // update on success.
              submit(
                { paused: next },
                {
                  onSuccess: () => {
                    setPaused(next);
                  },
                },
              );
            }}
            disabled={isPending}
            className="min-h-touch rounded-input border border-neutral-border bg-neutral-surface px-4 py-2 text-md text-neutral-body"
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
    </article>
  );
};
