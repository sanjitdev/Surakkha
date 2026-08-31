/**
 * Outbound client to the simulator control HTTP server — Story 2.5.
 *
 * The api POSTs a scenario switch to the simulator over an
 * adversarially-trusted HTTP channel. The wire contract:
 *
 *   POST ${SIMULATOR_URL}/admin/simulator/${device_id}/scenario
 *     headers:
 *       X-Simulator-Secret: ${SIMULATOR_SECRET}
 *       Content-Type: application/json
 *     body: { scenario: ScenarioName, paused?: boolean }
 *
 * Three failure modes are surfaced as typed errors so the api router
 * can map them to the right HTTP status:
 *
 *   - `unreachable`    — fetch threw / aborted (network error,
 *                        DNS fail, timeout via AbortController)
 *   - `secret_mismatch`— simulator returned 403 (wrong / short secret)
 *   - `unknown`        — any other non-2xx response (4xx validation,
 *                        5xx simulator crash, etc.)
 *
 * AbortController-based timeout: 5 s per call. The spec's SLA is
 * "scenario switch applied within 5 s"; the timeout matches that
 * budget so the api router's HTTP response to the SPA matches the
 * downstream effect the SPA can observe.
 */
import { type ScenarioName } from "@surakkha/shared/simulator";

import { HTTP_FORBIDDEN } from "../httpStatus.js";

/** Default per-call timeout — matches the spec's 5 s SLA. */
export const SIMULATOR_CLIENT_TIMEOUT_MS = 5_000;

const SECRET_HEADER = "X-Simulator-Secret";
const CONTENT_TYPE_JSON = "application/json";

export interface SimulatorClientDeps {
  /** Base URL of the simulator control server (e.g. `http://localhost:4001`). */
  readonly baseUrl: string;
  /** Shared secret to authenticate against the simulator's control server. */
  readonly secret: string;
  /**
   * Injectable `fetch` for tests. Production uses global `fetch`
   * (Node 20).
   */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Typed result of a simulator POST. Either `{ ok: true, data }` or
 * `{ ok: false, error }` where `error.kind` narrows the failure mode.
 */
export type SimulatorSwitchResult =
  | { readonly ok: true; readonly data: { readonly applied: true } }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "unreachable"; readonly cause: string }
        | { readonly kind: "secret_mismatch" }
        | {
            readonly kind: "unknown";
            readonly status: number;
            readonly body: unknown;
          };
    };

/**
 * Validate `SIMULATOR_URL` parses as an `http`/`https` URL with no
 * path beyond `/` and a non-empty hostname. Misconfigured values
 * (e.g. trailing `/api`, `..` segments, `file://`, `http://`) would
 * otherwise be concatenated blindly into the outbound URL. Returns
 * `null` on any failure.
 */
export const validateSimulatorBaseUrl = (raw: string): string | null => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.hostname === "") return null;
    // Reject any path beyond the bare origin so a misconfigured
    // `http://host/api` doesn't produce `http://host/api/admin/...`.
    if (parsed.pathname !== "/") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

/**
 * POST a scenario switch to the simulator. The function is pure with
 * respect to its inputs; the AbortController timeout is owned per
 * call so two concurrent calls cannot starve each other.
 */
export const postSimulatorScenario = async (
  deps: SimulatorClientDeps,
  deviceId: string,
  body: { readonly scenario: ScenarioName; readonly paused?: boolean },
): Promise<SimulatorSwitchResult> => {
  const baseUrl = validateSimulatorBaseUrl(deps.baseUrl);
  if (baseUrl === null) {
    return {
      ok: false,
      error: {
        kind: "unknown",
        status: 0,
        body: { reason: "invalid_simulator_url" },
      },
    };
  }
  const url = `${baseUrl.replace(/\/$/, "")}/admin/simulator/${deviceId}/scenario`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMULATOR_CLIENT_TIMEOUT_MS);
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        [SECRET_HEADER]: deps.secret,
        "Content-Type": CONTENT_TYPE_JSON,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.ok) {
      const data = (await res.json()) as { applied: true };
      return { ok: true, data };
    }

    if (res.status === HTTP_FORBIDDEN) {
      // Map simulator-side secret failure to our typed error so the
      // router can return the same 403 the SPA already knows.
      return { ok: false, error: { kind: "secret_mismatch" } };
    }

    // Best-effort parse of the error body. We do not want a malformed
    // body to throw — the router maps `unknown` to a 502 anyway.
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return {
      ok: false,
      error: { kind: "unknown", status: res.status, body: parsed },
    };
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.name === "AbortError"
          ? "timeout"
          : cause.message
        : String(cause);
    return { ok: false, error: { kind: "unreachable", cause: message } };
  } finally {
    clearTimeout(timeout);
  }
};
