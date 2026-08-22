/**
 * DeviceRow — Story 2.5.
 *
 * One row per device. Shows:
 *   - human label (`name`) + truncated UUID
 *   - current scenario badge
 *   - scenario `<select>` with the seven SCENARIO_NAMES
 *   - Switch button (disabled while the row's mutation is in flight)
 *   - Start / Pause toggle button
 *
 * The row is read-only on the `enabled === false` path; the parent
 * (`SimulatorPage`) instead renders the disabled banner above the
 * list and the rows are not rendered at all in that case.
 */
import { SCENARIO_NAMES } from "@surakkha/shared/simulator";
import { useState } from "react";

import {
  type SimulatorDevice,
  type SwitchScenarioError,
  useSwitchScenario,
} from "./useSimulatorDevices";

const BADGE_BG = "#E8F6EE";
const BADGE_TEXT = "#0F6B3A";

const PRIMARY = "#1E5BB8";

export interface DeviceRowProps {
  readonly device: SimulatorDevice;
  readonly onError: (err: SwitchScenarioError) => void;
  readonly onSuccess: (msg: string) => void;
}

export const DeviceRow = ({ device, onError, onSuccess }: DeviceRowProps) => {
  const [selected, setSelected] = useState<string>(
    device.scenario ?? "Normal",
  );
  const [paused, setPaused] = useState(false);
  const mutation = useSwitchScenario();

  const { isPending } = mutation;

  const submit = (
    body: { scenario?: string; paused?: boolean },
    overrides?: {
      readonly onSuccess?: () => void;
      readonly onError?: (err: SwitchScenarioError) => void;
    },
  ): void => {
    mutation.mutate(
      { deviceId: device.device_id, ...body },
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
      className="rounded-card border p-4"
      style={{
        backgroundColor: "#FFFFFF",
        borderColor: "#E2E8F0",
      }}
    >
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2
            className="text-md font-semibold"
            style={{ color: "#0F172A" }}
            data-testid={`simulator-row-name-${device.device_id}`}
          >
            {device.name ?? "Unnamed device"}
          </h2>
          <p
            className="text-sm"
            style={{ color: "#475569" }}
            data-testid={`simulator-row-id-${device.device_id}`}
          >
            {device.device_id}
          </p>
        </div>
        <span
          data-testid={`simulator-row-scenario-${device.device_id}`}
          className="rounded-pill px-3 py-1 text-sm font-medium"
          style={{ backgroundColor: BADGE_BG, color: BADGE_TEXT }}
        >
          {device.scenario ?? "Unknown"}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "#475569" }}>Switch to scenario</span>
          <select
            data-testid={`simulator-row-select-${device.device_id}`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={isPending}
            className="rounded-input border px-3 py-2 text-md"
            style={{
              borderColor: "#E2E8F0",
              color: "#0F172A",
              backgroundColor: "#FFFFFF",
            }}
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
            className="rounded-input px-4 py-2 text-md font-medium text-white"
            style={{ backgroundColor: PRIMARY }}
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
              submit({ paused: next }, {
                onSuccess: () => {
                  setPaused(next);
                },
              });
            }}
            disabled={isPending}
            className="rounded-input border px-4 py-2 text-md"
            style={{
              borderColor: "#E2E8F0",
              color: "#0F172A",
              backgroundColor: "#FFFFFF",
            }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
    </article>
  );
};
