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
import { z } from "zod";

import { apiFetch } from "../../api/apiClient";

/**
 * Wire-shape validator for `GET /admin/simulator/devices` (G3-06).
 * The api contract is `{ devices: SimulatorDevice[] }` — if a future
 * deploy renames `devices` or wraps the response, the SPA would
 * silently render 0 rows with no error. Validating at the boundary
 * makes a wire drift a visible `isError` instead of a misleading
 * empty state.
 */
const SimulatorDeviceSchema = z.object({
  device_id: z.string(),
  name: z.string().nullable(),
  scenario: z.string().nullable(),
});
const DevicesResponseSchema = z.object({
  devices: z.array(SimulatorDeviceSchema),
});

export interface SimulatorDevice {
  readonly device_id: string;
  readonly name: string | null;
  readonly scenario: string | null;
}

export interface SimulatorStatus {
  readonly enabled: boolean;
  /**
   * Mirror of the api wire shape on the 503-disabled-secret path
   * (per Spec I/O matrix line 47: `{ disabled: true, reason }`).
   * The SPA never *branches* on `disabled` — we always reduce to
   * `enabled: boolean` for the page — but the type documents the
   * round-trip so future contributors can trace the contract.
   */
  readonly disabled?: boolean;
  readonly reason?: string;
}

/**
 * Query the disabled-banner state. Anonymous (no Bearer header)
 * because the spec mandates that the disabled banner render for
 * unauthenticated users too — the spec's `enabled === false` path
 * must be reachable from a fresh page load before login.
 *
 * Wire contract (Story 2.5 / G2-01):
 *   - 200             → `{ enabled: true }`
 *   - 503             → `{ disabled: true, reason }`  (the documented
 *                        SIMULATOR_SECRET-missing case; the only
 *                        "operator-facing disabled" signal)
 *   - any other code  → throw, surfacing through TanStack Query's
 *                        `isError` so the page renders
 *                        `simulator-page-error` instead of misleadingly
 *                        claiming the secret is missing (G3-01).
 */
export const useSimulatorStatus = () =>
  useQuery<SimulatorStatus>({
    queryKey: ["admin", "simulator", "status"],
    queryFn: async () => {
      const res = await apiFetch("/admin/simulator/status", { skipAuth: true });
      if (res.status === 200) {
        const body = (await res.json()) as SimulatorStatus;
        // Pass through the api's body shape verbatim — previously we
        // synthesized a fresh `{ enabled: false }` for any non-200
        // (G3-11), but for the 200 happy path we trust the wire.
        return body;
      }
      if (res.status === HTTP_SERVICE_UNAVAILABLE) {
        // 503 is the documented disabled-secret path. Parse the body
        // defensively (a 503 from a misconfigured proxy may have an
        // empty body) and surface the spec shape verbatim.
        const body = (await res.json().catch(() => ({}))) as Partial<SimulatorStatus>;
        return {
          enabled: false,
          disabled: true,
          reason: body.reason ?? "missing",
        };
      }
      // Anything else (401 / 404 / 5xx / network blip) is a real
      // outage — throw so TanStack Query treats it as `isError` and
      // the page renders its `simulator-page-error` banner instead
      // of misleadingly claiming the secret is missing.
      throw new Error(`simulator status fetch failed: ${res.status}`);
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
      const parsed = DevicesResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        // Wire drift — log so operators can diagnose, throw so the
        // page renders its error banner instead of zero rows.
        console.error("simulator devices wire-shape mismatch", parsed.error);
        throw new Error("simulator devices wire-shape mismatch");
      }
      return parsed.data as { readonly devices: readonly SimulatorDevice[] };
    },
  });

/**
 * Mutate the simulator's scenario on a single device. Returns the
 * typed result so the page can branch on `error.kind` and render
 * the right toast.
 *
 * G3-02: the thrown error is the discriminated union itself (cast
 * to `Error` for TanStack-Query's signature). Consumers read
 * `err.kind` directly. Previously a `SimulatorSwitchError` wrapper
 * class was thrown, which made `err.kind` undefined at the call
 * site and produced empty toasts.
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

      // Read the body so we can branch on the wire shape. The api
      // collapses api-side missing-env into the spec's documented
      // `{ disabled: true }` shape (see packages/api simulatorRouter
      // G2-01), and we need to treat that as the same disabled-
      // banner transition as a 403 secret_mismatch (G3-03 / G3-04).
      const errBody = (await res
        .json()
        .catch(() => ({}))) as { error?: string; disabled?: boolean };

      // G3-03 / G3-04: a 403 OR a 503 with `{ disabled: true }` is
      // the secret-mismatch / missing-secret path; the spec (AC8)
      // wants the same disabled banner state. Surface `secret_mismatch`
      // so the page's mutation handler invalidates the status query
      // and the banner renders instead of a transient toast.
      // G3-15: 401 from token-refresh is handled by apiClient
      // (navigate-to-/login); no special-case here.
      const detail: SwitchScenarioError = (() => {
        if (res.status === HTTP_FORBIDDEN) return { kind: "secret_mismatch" };
        if (res.status === HTTP_SERVICE_UNAVAILABLE && errBody.disabled === true) {
          return { kind: "secret_mismatch" };
        }
        switch (res.status) {
          case HTTP_BAD_REQUEST:
            return { kind: "validation_error" };
          case HTTP_CONFLICT:
            return { kind: "switch_in_progress" };
          case HTTP_BAD_GATEWAY:
            return { kind: "simulator_unreachable" };
          default:
            return { kind: "unknown", status: res.status };
        }
      })();
      // Throw the discriminated union directly so the consumer's
      // `err.kind` resolves correctly. TanStack-Query requires its
      // error generic to be Error-shaped; we wrap the union in a
      // fresh `Error` and merge the `kind` (and any nested fields)
      // so the consumer code (`errorMessage(err)`) reads `err.kind`
      // directly without `instanceof`. The `as unknown as Error`
      // shape silences `no-throw-literal`.
      const wrapped = new Error(
        `simulator switch failed: ${detail.kind}`,
      ) as Error & SwitchScenarioError;
      Object.assign(wrapped, detail);
      throw wrapped;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "simulator", "devices"] });
    },
  });
};