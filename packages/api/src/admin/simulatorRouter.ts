/**
 * Admin simulator router — Surakkha api (Story 2.5).
 *
 * Three routes:
 *
 *   GET  /admin/simulator/status
 *     - Public (no auth, no RBAC). Returns `{ enabled: true }` when
 *       SIMULATOR_SECRET is set on the api side; `{ enabled: false,
 *       reason: "missing" }` otherwise. The disabled banner must
 *       render for any authenticated user who navigates to the admin
 *       tab; a 401/403 on this endpoint would lock them out of the
 *       banner itself.
 *
 *   GET  /admin/simulator/devices
 *     - Admin-only via `authorize({ action: "read", resource: "Device" }, audit)`.
 *       (The matrix grants Admin.read.Device; Simulator.read is N
 *       for all roles — see `packages/shared/src/rbac.ts:113` — but
 *       reading the device list is not a Simulator-specific action,
 *       so Device.read is the correct gate.) Returns six rows from
 *       the Prisma `Device` table.
 *
 *   POST /admin/simulator/:device_id/scenario
 *     - Admin-only via `authorize({ action: "drive", resource: "Simulator" }, audit)`.
 *       Validates the body via Zod, single-flight per device (409 on
 *       a second concurrent switch), then POSTs to the simulator's
 *       control server. On success, writes an `AuditLog` row via the
 *       structured logger.
 */
import { isUuidV4 } from "@surakkha/shared";
import { SCENARIO_NAMES, type ScenarioName } from "@surakkha/shared/simulator";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit";
import { ERROR_CODES } from "../errors.js";
import {
  HTTP_BAD_GATEWAY,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_OK,
  HTTP_SERVICE_UNAVAILABLE,
} from "../httpStatus.js";
import { authorize, type AuthorizedRequest, markPublic } from "../middleware/authorize";

import {
  postSimulatorScenario,
  type SimulatorClientDeps,
  type SimulatorSwitchResult,
} from "./simulatorClient.js";

/**
 * Body shape for POST /admin/simulator/:device_id/scenario.
 *
 * Story 2.5 loopback-1 fix (P4 + P17):
 *   - `scenario` is a plain `string` here so we can branch on
 *     `value ∈ SCENARIO_NAMES` and return the spec-mandated
 *     `{ error: "invalid_scenario" }` (NOT `validation_error`).
 *   - `.refine(...)` enforces "at least one of scenario / paused",
 *     so an empty body fails Zod validation and surfaces as
 *     `validation_error` (P17) rather than `missing_action`.
 *   - `.strict()` rejects unknown keys — extra fields belong to
 *     `validation_error` per the spec.
 */
const scenarioSwitchBodySchema = z
  .object({
    scenario: z.string().optional(),
    paused: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.scenario !== undefined || b.paused !== undefined, {
    message: "must include scenario or paused",
  });

const SCENARIO_SET: ReadonlySet<ScenarioName> = new Set(SCENARIO_NAMES);

/**
 * Single-flight per device (P5). The depth invariant:
 *   - depth = 1 → first request is in-flight
 *   - depth = 2 → second request is queued behind the first
 *   - depth ≥ 3 → third+ request returns 409 `switch_in_progress`
 *
 * `pendingSwitches` holds the in-flight promise for a given device_id.
 * The `pendingDepth` counter is incremented when a request STARTS work
 * (queue-acceptance, not 409 rejection). The 409 path never mutates
 * the maps — a burst of three concurrent POSTs leaves depth = 2, not
 * 3 (G2-04 fix). The `finally` block decrements and clears the maps
 * once depth drains to 0.
 *
 * The data structures are module-scoped so concurrent POSTs (e.g.
 * two admins double-clicking Switch) coalesce correctly without a
 * race.
 */
const pendingSwitches = new Map<string, Promise<unknown>>();
const pendingDepth = new Map<string, number>();

/** Same minimum as `JWT_SECRET` and the simulator-side
 * `resolveSimulatorSecret`. Below this length the api treats the
 * secret as missing — symmetric enforcement so the api doesn't
 * happily accept a 1-character secret that the simulator would
 * reject. */
const SIMULATOR_SECRET_MIN_LENGTH = 32;

/**
 * Resolve the api's outbound `SIMULATOR_SECRET` and the simulator
 * base URL. Returns `null` when secret is missing or below the
 * minimum length — the caller maps that to 503 `{ disabled: true }`
 * and skips any outbound call. The same 32-char minimum that the
 * simulator enforces (`resolveSimulatorSecret` in
 * `packages/simulator/src/control/server.ts`) is mirrored here so the
 * two sides cannot drift into "api thinks enabled, simulator thinks
 * disabled" (spec line 26: "Missing/short on either side → disabled
 * state").
 */
interface ResolvedSimulatorConfig {
  readonly baseUrl: string;
  readonly secret: string;
}

const resolveSimulatorConfig = (): ResolvedSimulatorConfig | null => {
  const secret = process.env["SIMULATOR_SECRET"];
  if (secret === undefined || secret === "") return null;
  if (secret.length < SIMULATOR_SECRET_MIN_LENGTH) return null;
  const baseUrl = process.env["SIMULATOR_URL"] ?? "http://localhost:4001";
  return { baseUrl, secret };
};

export interface SimulatorRouterDeps {
  readonly audit: AuditLogger;
  /**
   * Inject the device repository. The production wiring uses
   * `@prisma/client`'s `Device.findMany`; tests inject a stub.
   */
  readonly listDevices: () => Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string | null;
      readonly scenario: string | null;
    }>
  >;
  /**
   * Optional injectable `fetch` used by the outbound simulator
   * client. Tests stub this to drive unreachable / secret_mismatch /
   * success branches without overriding `globalThis.fetch` (which
   * the test runner also uses to talk to the api). Production
   * callers omit this and the router falls back to the global
   * `fetch`.
   */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Translate a `SimulatorSwitchResult` into the HTTP envelope the SPA
 * knows. Module-scoped so the route handler can stay under the
 * eslint complexity ceiling.
 */
const renderSwitchResult = (result: SimulatorSwitchResult, res: Response): void => {
  if (result.ok) {
    res.status(HTTP_OK).json(result.data);
    return;
  }
  if (result.error.kind === "secret_mismatch") {
    res.status(HTTP_FORBIDDEN).json({ error: ERROR_CODES.SECRET_MISMATCH.value });
    return;
  }
  if (result.error.kind === "unreachable") {
    res.status(HTTP_BAD_GATEWAY).json({ error: ERROR_CODES.SIMULATOR_UNREACHABLE.value });
    return;
  }
  // unknown: simulator rejected the request shape or crashed.
  res.status(HTTP_BAD_GATEWAY).json({
    error: ERROR_CODES.SIMULATOR_UNREACHABLE.value,
    upstream: result.error,
  });
};

/**
 * Validate the inbound POST: device_id (URL) is a v4 UUID, body is a
 * valid `ScenarioSwitch`, and at least one of `scenario` / `paused`
 * is present. Writes the failure response when validation fails and
 * returns `{ ok: false }` so the caller can early-return.
 *
 * Loopback-1 fix (P4): when the body parses OK but `scenario` is a
 * non-`SCENARIO_NAMES` string AND `paused === undefined`, return
 * `{ error: "invalid_scenario" }` (NOT `validation_error`).
 *
 * Loopback-1 fix (P17): an empty body (`{}`) is now caught by the
 * Zod `.refine(...)` and surfaces as `validation_error` (no more
 * separate `missing_action` branch for the empty body case).
 */
type ScenarioSwitchBody = z.infer<typeof scenarioSwitchBodySchema>;

const validateScenarioRequest = (
  req: AuthorizedRequest,
  res: Response,
):
  | { readonly ok: true; readonly deviceId: string; readonly body: ScenarioSwitchBody }
  | { readonly ok: false } => {
  const deviceId = req.params["device_id"];
  if (deviceId === undefined || typeof deviceId !== "string" || !isUuidV4(deviceId)) {
    res.status(HTTP_BAD_REQUEST).json({ error: ERROR_CODES.INVALID_DEVICE_ID.value });
    return { ok: false };
  }

  const parsed = scenarioSwitchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(HTTP_BAD_REQUEST)
      .json({ error: ERROR_CODES.VALIDATION_ERROR.value, issues: parsed.error.issues });
    return { ok: false };
  }
  const body = parsed.data;
  // Spec P4 — distinguish "unknown scenario" (loud, dedicated error
  // code so the SPA can show a tailored toast) from "malformed body"
  // (generic `validation_error`). ANY unknown scenario name yields
  // `invalid_scenario` — even when paired with `paused` (AC5 promises
  // 400 invalid_scenario for any unknown name, regardless of
  // accompanying fields). The `paused` field is accepted by the
  // schema as long as it's a boolean.
  if (body.scenario !== undefined && !SCENARIO_SET.has(body.scenario as ScenarioName)) {
    res.status(HTTP_BAD_REQUEST).json({ error: ERROR_CODES.INVALID_SCENARIO.value });
    return { ok: false };
  }
  return { ok: true, deviceId, body };
};

/**
 * Public surface — `/status` only. Mounted BEFORE `app.use(authenticate)`
 * in the production wiring so the disabled banner renders for
 * unauthenticated users. The authenticated routes live on the
 * `buildAdminSimulatorRouter` router and are mounted AFTER
 * `authenticate`.
 */
export const buildAdminSimulatorPublicRouter = (): Router => {
  const router = express.Router();
  router.get(
    "/admin/simulator/status",
    markPublic((_req, res) => {
      const cfg = resolveSimulatorConfig();
      if (cfg === null) {
        // Unify disabled-state shape with the authenticated POST
        // path: `{ disabled: true, reason: "missing" }`. The spec's
        // I/O matrix (line 47) pins `{ disabled: true }` for GET,
        // and using the same shape across GET and POST lets the SPA
        // collapse both to one banner state without branching.
        res.status(HTTP_SERVICE_UNAVAILABLE).json({
          disabled: true,
          reason: "missing",
        });
        return;
      }
      res.status(HTTP_OK).json({ enabled: true });
    }),
  );
  return router;
};

/**
 * Build the Express router. Tests construct a router with stubbed
 * `listDevices` and override `process.env.SIMULATOR_SECRET` to drive
 * the disabled / enabled branches.
 */
export const buildAdminSimulatorRouter = (deps: SimulatorRouterDeps): Router => {
  const router = express.Router();

  /**
   * GET /admin/simulator/status — public, no RBAC. The admin tab
   * needs this on every render to know whether to show the disabled
   * banner. The production wiring exposes this via
   * `buildAdminSimulatorPublicRouter()` mounted BEFORE
   * `authenticate()`; the duplicate registration here is a safety
   * net so the route works when the router is mounted standalone
   * (e.g., in tests that exercise only the authenticated surface).
   */
  router.get(
    "/status",
    markPublic((_req, res) => {
      const cfg = resolveSimulatorConfig();
      if (cfg === null) {
        // Mirrors the public GET shape: `{ disabled: true, reason:
        // "missing" }` for symmetry with the POST 503 path.
        res.status(HTTP_SERVICE_UNAVAILABLE).json({
          disabled: true,
          reason: "missing",
        });
        return;
      }
      res.status(HTTP_OK).json({ enabled: true });
    }),
  );

  /**
   * GET /admin/simulator/devices — Admin-only. Returns the six
   * default devices + their current scenarios. The matrix grants
   * Admin.read.Device but denies Simulator.read (per RBAC_MATRIX row
   * `Admin.read.Simulator: N`), so we use `Device.read` instead.
   * Story 1.5 already grants Device.read to Admin/Operator/
   * Technician/Viewer; the page is gated by `<RbacRoute>` so only
   * Admin reaches it.
   */
  router.get(
    "/devices",
    authorize({ action: "read", resource: "Device" }, deps.audit),
    async (_req, res) => {
      const rows = await deps.listDevices();
      res.status(HTTP_OK).json({
        devices: rows.map((r) => ({
          device_id: r.id,
          name: r.name,
          scenario: r.scenario,
        })),
      });
    },
  );

  /**
   * POST /admin/simulator/:device_id/scenario — Admin-only via
   * `drive × Simulator` (matrix grants Admin only). Validates the
   * body, single-flight per device, then POSTs to the simulator.
   */
  router.post(
    "/:device_id/scenario",
    authorize({ action: "drive", resource: "Simulator" }, deps.audit),
    async (req: AuthorizedRequest, res) => {
      const validated = validateScenarioRequest(req, res);
      if (!validated.ok) return;
      const { deviceId, body } = validated;

      const cfg = resolveSimulatorConfig();
      if (cfg === null) {
        res.status(HTTP_SERVICE_UNAVAILABLE).json({ disabled: true, reason: "missing" });
        return;
      }

      // Single-flight per device (P5): size-1 queue. The second
      // concurrent POST awaits the FIRST request's promise; only if
      // a THIRD request lands while the second is queued do we
      // reject with 409 `switch_in_progress`. This keeps the
      // contract: "second request is queued, never silently dropped"
      // — but the queue has a tight bound.
      const depth = (pendingDepth.get(deviceId) ?? 0) + 1;
      if (depth > 2) {
        // 409 path: do NOT mutate `pendingDepth`. The 409 returns
        // synchronously without ever awaiting work, so the depth
        // counter is unaffected — a burst of three concurrent POSTs
        // leaves depth = 2, not 3. The `finally` block on accepted
        // requests clears the map once depth drains to 0.
        res.status(HTTP_CONFLICT).json({ error: ERROR_CODES.SWITCH_IN_PROGRESS.value });
        return;
      }
      pendingDepth.set(deviceId, depth);

      const clientDeps: SimulatorClientDeps = {
        baseUrl: cfg.baseUrl,
        secret: cfg.secret,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      };

      // Build the body shape expected by the simulator. The
      // simulator's `paused` field is a verb in its own right; we
      // forward it unchanged when present. `scenario` is typed as
      // `string` in the inbound schema (so we can branch on it and
      // return `invalid_scenario`); the `SCENARIO_SET` check above
      // already narrowed it to a `ScenarioName` when `paused ===
      // undefined`, but the narrowed type doesn't survive the
      // schema parse.
      const outbound: { scenario?: ScenarioName; paused?: boolean } = {};
      if (body.scenario !== undefined && body.paused === undefined) {
        outbound.scenario = body.scenario as ScenarioName;
      }
      if (body.paused !== undefined) outbound.paused = body.paused;

      // The first request gets its own fresh promise. The second
      // request awaits THIS promise and re-runs the outbound call.
      // The queue is bounded — `depth > 2` above already rejected
      // any third request.
      const firstPromise = pendingSwitches.get(deviceId);
      const work = (async (): Promise<SimulatorSwitchResult> => {
        if (firstPromise !== undefined) {
          // Wait for the first request's promise to settle, but
          // DON'T re-use its result — the second request is its
          // own action with its own body. We just want the queue
          // ordering, not result coalescing.
          try {
            await firstPromise;
          } catch {
            // The first request's failure doesn't block this one —
            // we still attempt our own outbound call.
          }
        }
        const result = await postSimulatorScenario(
          clientDeps,
          deviceId,
          outbound as { scenario: ScenarioName; paused?: boolean },
        );
        // Loopback-1 fix (P6): emit the `simulator_event` audit row
        // ONLY on success. On failure (400/502/409/403/etc.) the
        // `rbac_denied` row from the middleware is the only audit
        // surface — the spec says "no AuditLog row is written" on
        // a failed switch.
        if (result.ok) {
          // Spec payload shape is `{ device_id, scenario }`. We
          // conditionally include `paused` only when the admin
          // actually set it — a scenario-only switch records
          // `{ device_id, scenario }`, a pause-only switch records
          // `{ device_id, paused: true }`.
          const context: Record<string, unknown> = { device_id: deviceId };
          if (body.scenario !== undefined) context["scenario"] = body.scenario;
          if (body.paused !== undefined) context["paused"] = body.paused;
          deps.audit.emit({
            auditAction: "simulator_event",
            userId: req.user?.id,
            outcome: "success",
            context,
          });
        }
        return result;
      })();

      // Track this promise as the next "first" for any queued
      // request that follows.
      pendingSwitches.set(deviceId, work);

      try {
        const result = await work;
        renderSwitchResult(result, res);
      } finally {
        // Decrement the queue depth; clear the registry entry when
        // the queue drains.
        const remaining = depth - 1;
        if (remaining <= 0) {
          pendingDepth.delete(deviceId);
          pendingSwitches.delete(deviceId);
        } else {
          pendingDepth.set(deviceId, remaining);
        }
      }
    },
  );

  return router;
};
