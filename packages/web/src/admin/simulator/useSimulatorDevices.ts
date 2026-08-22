/**
 * TanStack Query hooks for the simulator admin tab — Story 2.5.
 *
 * Two query keys:
 *   - `["admin", "simulator", "status"]` — `enabled` flag, no auth
 *   - `["admin", "simulator", "devices"]` — six-row device list
 *
 * The mutation invalidates the `devices` key on success so the
 * optimistic `applied` state survives until the server's view
 * catches up. No optimistic update is applied on the UI side —
 * the toast + invalidation flow is explicit so a failure surfaces
 * truthfully rather than showing a "Switched!" toast that the
 * server never accepted.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "../../api/apiClient";

export interface SimulatorDevice {
  readonly device_id: string;
  readonly name: string | null;
  readonly scenario: string | null;
}

export interface SimulatorStatus {
  readonly enabled: boolean;
  readonly reason?: string;
}

/**
 * Query the disabled-banner state. Anonymous (no Bearer header)
 * because the spec mandates that the disabled banner render for
 * unauthenticated users too — the spec's `enabled === false` path
 * must be reachable from a fresh page load before login.
 */
export const useSimulatorStatus = () =>
  useQuery<SimulatorStatus>({
    queryKey: ["admin", "simulator", "status"],
    queryFn: async () => {
      const res = await apiFetch("/admin/simulator/status", { skipAuth: true });
      if (res.status === 200) {
        return (await res.json()) as SimulatorStatus;
      }
      // The router returns 503 with `{ enabled: false, reason }` when
      // SIMULATOR_SECRET is unset on the api side. Treat any non-200
      // as "disabled" so a 5xx / network blip doesn't crash the page.
      const body = (await res.json().catch(() => ({}))) as Partial<SimulatorStatus>;
      return {
        enabled: false,
        reason: body.reason ?? "missing",
      };
    },
  });

export const useSimulatorDevices = () =>
  useQuery<{ readonly devices: readonly SimulatorDevice[] }>({
    queryKey: ["admin", "simulator", "devices"],
    queryFn: async () => {
      const res = await apiFetch("/admin/simulator/devices");
      if (!res.ok) {
        throw new Error(`simulator devices fetch failed: ${res.status}`);
      }
      return (await res.json()) as { readonly devices: readonly SimulatorDevice[] };
    },
  });

/**
 * Mutate the simulator's scenario on a single device. Returns the
 * typed result so the page can branch on `error.kind` and render
 * the right toast.
 */
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

/** Map an outbound HTTP status to a typed `SwitchScenarioError`. */
class SimulatorSwitchError extends Error {
  public readonly detail: SwitchScenarioError;
  public constructor(detail: SwitchScenarioError) {
    super(`simulator switch failed: ${detail.kind}`);
    this.detail = detail;
    this.name = "SimulatorSwitchError";
  }
}

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

export const useSwitchScenario = () => {
  const qc = useQueryClient();
  return useMutation<
    { readonly applied: true },
    SwitchScenarioError,
    SwitchScenarioVars
  >({
    mutationFn: async (vars) => {
      const body: Record<string, unknown> = {};
      if (vars.scenario !== undefined) body["scenario"] = vars.scenario;
      if (vars.paused !== undefined) body["paused"] = vars.paused;

      const res = await apiFetch(
        `/admin/simulator/${encodeURIComponent(vars.deviceId)}/scenario`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );

      if (res.ok) {
        return (await res.json()) as { applied: true };
      }

      // Drain the body so the socket can be reused; we don't read it
      // because the api returns flat shapes we already map to `kind`.
      await res.json().catch(() => undefined);

      const detail: SwitchScenarioError = (() => {
        switch (res.status) {
          case HTTP_FORBIDDEN:
            return { kind: "secret_mismatch" };
          case HTTP_BAD_REQUEST:
            return { kind: "validation_error" };
          case HTTP_CONFLICT:
            return { kind: "switch_in_progress" };
          case HTTP_BAD_GATEWAY:
          case HTTP_SERVICE_UNAVAILABLE:
            return { kind: "simulator_unreachable" };
          default:
            return { kind: "unknown", status: res.status };
        }
      })();
      throw new SimulatorSwitchError(detail);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "simulator", "devices"] });
    },
  });
};