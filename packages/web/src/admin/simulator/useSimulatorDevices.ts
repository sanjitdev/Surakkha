/**
 * `useSimulatorDevices` — TanStack Query hooks for the simulator admin tab.
 *
 * Three hooks:
 *   - `useSimulatorStatus`     — `{ enabled: boolean }` (anonymous).
 *   - `useSimulatorDevices`    — six-row device list (authenticated).
 *   - `useSwitchScenario`      — POST scenario / paused; typed error.
 *
 * Mutations invalidate the `devices` key on success. No optimistic
 * UI — failures surface through toasts and the next refetch
 * restores truth.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../../api/apiClient";

/** Wire-shape validator for the devices endpoint. Makes a wire drift
 *  a visible `isError` instead of a silent zero-row render. */
const SimulatorDeviceSchema = z.object({
  device_id: z.string(),
  name: z.string().nullable(),
  scenario: z.string().nullable(),
});
const DevicesResponseSchema = z.object({
  devices: z.array(SimulatorDeviceSchema),
});

const SIMULATOR_STATUS_KEY = ["admin", "simulator", "status"] as const;
const SIMULATOR_DEVICES_KEY = ["admin", "simulator", "devices"] as const;

export interface SimulatorDevice {
  readonly device_id: string;
  readonly name: string | null;
  readonly scenario: string | null;
}

export interface SimulatorStatus {
  readonly enabled: boolean;
  /** Api wire shape on the 503-disabled path — the page reduces
   *  to `enabled: boolean` for rendering, but the type documents
   *  the round-trip. */
  readonly disabled?: boolean;
  readonly reason?: string;
}

export const useSimulatorStatus = () =>
  useQuery<SimulatorStatus>({
    queryKey: SIMULATOR_STATUS_KEY,
    queryFn: async () => {
      const res = await apiFetch("/admin/simulator/status", { skipAuth: true });
      if (res.status === 200) {
        return (await res.json()) as SimulatorStatus;
      }
      if (res.status === HTTP_SERVICE_UNAVAILABLE) {
        const body = (await res.json().catch(() => ({}))) as Partial<SimulatorStatus>;
        return {
          enabled: false,
          disabled: true,
          reason: body.reason ?? "missing",
        };
      }
      // Real outage — throw so the page renders its error banner
      // instead of misleadingly claiming the secret is missing.
      throw new Error(`simulator status fetch failed: ${res.status}`);
    },
  });

export const useSimulatorDevices = () =>
  useQuery<{ readonly devices: readonly SimulatorDevice[] }>({
    queryKey: SIMULATOR_DEVICES_KEY,
    queryFn: async () => {
      const res = await apiFetch("/admin/simulator/devices");
      if (!res.ok) {
        throw new Error(`simulator devices fetch failed: ${res.status}`);
      }
      const parsed = DevicesResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("simulator devices wire-shape mismatch", parsed.error);
        throw new Error("simulator devices wire-shape mismatch");
      }
      return parsed.data as { readonly devices: readonly SimulatorDevice[] };
    },
  });

export interface SwitchScenarioVars {
  readonly deviceId: string;
  readonly scenario?: string;
  readonly paused?: boolean;
}

export type SwitchScenarioError =
  | { readonly kind: "secret_mismatch" }
  | { readonly kind: "simulator_unreachable" }
  | { readonly kind: "switch_in_progress" }
  | { readonly kind: "validation_error" }
  | { readonly kind: "unknown"; readonly status: number };

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

/** Map a non-ok response to the discriminated union the page reads
 *  via `err.kind`. Pure helper; called from the mutation body. */
const classifySwitchError = (
  status: number,
  disabled: boolean | undefined,
): SwitchScenarioError => {
  if (status === HTTP_FORBIDDEN) return { kind: "secret_mismatch" };
  if (status === HTTP_SERVICE_UNAVAILABLE && disabled === true) {
    return { kind: "secret_mismatch" };
  }
  switch (status) {
    case HTTP_BAD_REQUEST:
      return { kind: "validation_error" };
    case HTTP_CONFLICT:
      return { kind: "switch_in_progress" };
    case HTTP_BAD_GATEWAY:
      return { kind: "simulator_unreachable" };
    default:
      return { kind: "unknown", status };
  }
};

export const useSwitchScenario = () => {
  const qc = useQueryClient();
  return useMutation<{ readonly applied: true }, SwitchScenarioError, SwitchScenarioVars>({
    mutationFn: async (vars) => {
      const body: Record<string, unknown> = {};
      if (vars.scenario !== undefined) body["scenario"] = vars.scenario;
      if (vars.paused !== undefined) body["paused"] = vars.paused;

      const res = await apiFetch(`/admin/simulator/${encodeURIComponent(vars.deviceId)}/scenario`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return (await res.json()) as { applied: true };
      }

      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
        disabled?: boolean;
      };

      // A 403 OR a 503 with `{ disabled: true }` is the secret-mismatch /
      // missing-secret path; surface `secret_mismatch` so the page's
      // mutation handler invalidates the status query and the banner
      // renders instead of a transient toast.
      const detail: SwitchScenarioError = classifySwitchError(res.status, errBody.disabled);
      throw detail;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SIMULATOR_DEVICES_KEY });
    },
  });
};
