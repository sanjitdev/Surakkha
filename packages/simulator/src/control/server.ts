/**
 * Simulator control HTTP server — Story 2.5.
 *
 * Plain Node `http.createServer` (no Express) that exposes:
 *
 *   POST /admin/simulator/:device_id/scenario
 *     - Body: { scenario: ScenarioName }
 *     - Validates `X-Simulator-Secret` (constant-time compare against
 *       `process.env.SIMULATOR_SECRET`).
 *     - Looks up the device_id in the simulator's module-scoped
 *       client registry (lifted out of `boot()` so the registry is
 *       readable from this server) and applies the new scenario.
 *
 *   GET /admin/simulator/status
 *     - Returns `{ enabled: true|false }`. Always public (no auth, no
 *       RBAC) so the api can render a disabled banner for any
 *       authenticated user who navigates to the admin tab.
 *
 * The port defaults to `SIMULATOR_CONTROL_PORT` (4001) and is
 * intentionally different from the api's HTTP port (3000) and the
 * WebSocket telemetry port so the three surfaces cannot collide.
 *
 * Story 2.5 AC: secret mismatches return 403, missing env returns 503,
 * unknown device_id returns 404, invalid scenario returns 400. All
 * comparisons are constant-time (`crypto.timingSafeEqual`).
 */
import { timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { createLogger } from "@surakkha/shared/logger";

import { SCENARIO_NAMES, type ScenarioName } from "../scenarios.js";

const logger = createLogger({
  name: "surakkha-simulator-control",
  level: "info",
});

const DEFAULT_CONTROL_PORT = 4_001;

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SECRET_HEADER = "x-simulator-secret";
const CONTENT_TYPE_JSON = "application/json";
/** Hard cap on the simulator control POST body. 16 KB is plenty for
 * `{ scenario: "RisingTDS" }` and prevents a misbehaving caller from
 * OOMing the simulator with a single request. */
// eslint-disable-next-line no-magic-numbers -- 16 KiB cap, named for clarity
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Lightweight per-device view exposed by the simulator's module-
 * scoped registry. `WsClient` implements the surface directly; we
 * declare it here as a structural interface so `server.ts` does not
 * import from `index.ts` (avoiding the circular import).
 */
export interface SimulatorClientLike {
  setScenario(name: ScenarioName): void;
  setPaused(paused: boolean): void;
}

/**
 * Singleton client registry — populated by `index.ts:boot()` and
 * consulted by the control server. The explicit getter/setter pair
 * keeps tests from having to spin up a real `boot()`.
 */
let clientsRegistry: ReadonlyMap<string, SimulatorClientLike> = new Map();

export const setClientsRegistry = (
  next: ReadonlyMap<string, SimulatorClientLike>,
): void => {
  clientsRegistry = next;
};

export const getClientsRegistry = (): ReadonlyMap<string, SimulatorClientLike> =>
  clientsRegistry;

const SCENARIO_SET: ReadonlySet<ScenarioName> = new Set(SCENARIO_NAMES);

const isScenarioName = (value: unknown): value is ScenarioName =>
  typeof value === "string" && SCENARIO_SET.has(value as ScenarioName);

/**
 * Resolve `SIMULATOR_SECRET` from the env. The discriminated union
 * shape mirrors `resolveJwtSecret` (`src/jwt.ts`) so callers can
 * branch on `ok` without try/catch.
 *
 * Story 2.5 AC: missing/short secret → disabled state, NOT fail-fast.
 * The single `missing` reason folds "unset" and "below the 32-char
 * minimum" together — both surface as the same disabled-banner copy
 * ("Simulator disabled. Set SIMULATOR_SECRET.") on the api side, so
 * a single reason keeps the public contract lean.
 */
export const resolveSimulatorSecret = ():
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: "missing" } => {
  const raw = process.env["SIMULATOR_SECRET"];
  if (raw === undefined || raw === "") {
    return { ok: false, reason: "missing" };
  }
  // Same minimum as JWT_SECRET (32 chars). Anything shorter is too
  // easy to brute-force — collapse the rejection under the same
  // `missing` reason so the disabled-banner copy is the same.
  if (raw.length < 32) {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, value: raw };
};

/**
 * Constant-time compare two strings. Reject non-matching lengths
 * BEFORE the comparison so `timingSafeEqual` never throws on the
 * "different buffer lengths" path.
 */
const constantTimeEquals = (provided: string, expected: string): boolean => {
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return timingSafeEqual(a, b);
};

const readSecretFromHeader = (req: IncomingMessage): string | null => {
  const raw = req.headers[SECRET_HEADER];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return null;
};

/**
 * Read the JSON body of an incoming POST. Caps the body at
 * `MAX_BODY_BYTES` so a misbehaving client cannot OOM the simulator
 * with a single request.
 */
const readJsonBody = async (
  req: IncomingMessage,
  limit = MAX_BODY_BYTES,
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limit) {
      throw new Error("payload_too_large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
};

const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
): void => {
  const target = res;
  target.statusCode = status;
  target.setHeader("Content-Type", CONTENT_TYPE_JSON);
  target.end(JSON.stringify(body));
};

/**
 * Parse the URL path into its canonical `/admin/simulator/...`
 * segments. Returns null for any path outside the expected shape.
 */
interface ParsedRoute {
  readonly kind: "status" | "scenario";
  readonly deviceId?: string;
}

const SCENARIO_SUFFIX = "/scenario";

/**
 * Validate a single segment as a v4 UUID. Returns the segment when
 * valid, `null` otherwise. Lifted out of `parseRoute` so the function
 * stays under the eslint complexity ceiling.
 */
const parseUuidSegment = (segment: string): string | null => {
  if (segment === "") return null;
  if (segment.includes("/")) return null;
  if (!UUID_V4_REGEX.test(segment)) return null;
  return segment;
};

const parseRoute = (rawUrl: string): ParsedRoute | null => {
  // Strip the query string.
  const pathOnly = rawUrl.split("?")[0] ?? "/";
  if (pathOnly === "/admin/simulator/status") return { kind: "status" };
  const scenarioPrefix = "/admin/simulator/";
  if (!pathOnly.startsWith(scenarioPrefix)) return null;
  // Strip prefix; what remains is `<uuid>` or `<uuid>/scenario`.
  const rest = pathOnly.slice(scenarioPrefix.length);
  if (rest.endsWith(SCENARIO_SUFFIX)) {
    const deviceId = parseUuidSegment(
      rest.slice(0, rest.length - SCENARIO_SUFFIX.length),
    );
    return deviceId === null ? null : { kind: "scenario", deviceId };
  }
  // /admin/simulator/<uuid> (GET used as a fallback when the api is
  // dispatching via Express — kept for completeness).
  const deviceId = parseUuidSegment(rest);
  return deviceId === null ? null : { kind: "scenario", deviceId };
};

/**
 * Resolve a `secretResult` shape into the disabled-state response, or
 * `null` when the secret is present and valid.
 */
const disabledResponse = (
  secretResult: { readonly ok: false; readonly reason: "missing" },
): { readonly status: number; readonly body: unknown } => ({
  status: HTTP_SERVICE_UNAVAILABLE,
  body: { disabled: true, reason: secretResult.reason },
});

/**
 * Apply the parsed body to the matching client. Lifted out of the
 * request handler so the route function stays under the complexity
 * ceiling.
 */
const applyControlBody = (
  deviceId: string,
  bodyRecord: Record<string, unknown>,
): { readonly status: number; readonly body: unknown } | null => {
  const { scenario, paused } = bodyRecord;
  // Allow either `{ scenario: "RisingTDS" }` or `{ paused: true }`
  // (or both). The simulator's control surface is a single endpoint;
  // the api translates the admin tab's Start / Pause / Switch
  // primitives into the matching verb.
  if (scenario === undefined && paused === undefined) {
    return { status: HTTP_BAD_REQUEST, body: { error: "missing_action" } };
  }
  if (scenario !== undefined && !isScenarioName(scenario)) {
    return { status: HTTP_BAD_REQUEST, body: { error: "invalid_scenario" } };
  }
  const client = clientsRegistry.get(deviceId);
  if (client === undefined) {
    return { status: HTTP_NOT_FOUND, body: { error: "unknown_device" } };
  }
  if (scenario !== undefined) {
    client.setScenario(scenario);
  }
  if (typeof paused === "boolean") {
    client.setPaused(paused);
  }
  logger.info({ deviceId, scenario, paused }, "simulator: control applied");
  return { status: HTTP_OK, body: { applied: true } };
};

/**
 * Handle the scenario-switch branch. Reads JSON, looks up the client,
 * applies the action.
 */
const handleScenarioRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  deviceId: string,
): Promise<void> => {
  if (req.method !== "POST") {
    sendJson(res, HTTP_BAD_REQUEST, { error: "method_not_allowed" });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, HTTP_BAD_REQUEST, {
      error:
        message === "invalid_json" ? "invalid_json" : "payload_too_large",
    });
    return;
  }
  const bodyRecord =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const result = applyControlBody(deviceId, bodyRecord);
  if (result === null) {
    sendJson(res, HTTP_NOT_FOUND, { error: "unknown_device" });
    return;
  }
  sendJson(res, result.status, result.body);
};

/**
 * The actual request handler, lifted out so `buildControlHandler`
 * doesn't return an arrow function from an arrow function (eslint
 * `unicorn/consistent-function-scoping`).
 */
const handleControlRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const route = parseRoute(req.url ?? "/");
  if (route === null) {
    sendJson(res, HTTP_NOT_FOUND, { error: "not_found" });
    return;
  }

  const secretResult = resolveSimulatorSecret();
  if (!secretResult.ok) {
    // Disabled state — same response shape on /status and /scenario
    // so the api can render the disabled banner without parsing the
    // route.
    const disabled = disabledResponse(secretResult);
    sendJson(res, disabled.status, disabled.body);
    return;
  }

  const providedSecret = readSecretFromHeader(req);
  // Reject non-matching lengths BEFORE the constant-time compare.
  if (
    providedSecret === null ||
    !constantTimeEquals(providedSecret, secretResult.value)
  ) {
    sendJson(res, HTTP_FORBIDDEN, { error: "secret_mismatch" });
    return;
  }

  if (route.kind === "status") {
    sendJson(res, HTTP_OK, { enabled: true });
    return;
  }

  // route.kind === "scenario"
  const { deviceId } = route;
  if (deviceId === undefined) {
    sendJson(res, HTTP_NOT_FOUND, { error: "not_found" });
    return;
  }
  await handleScenarioRoute(req, res, deviceId);
};

/**
 * Build the request handler. The handlers are returned as a function
 * so tests can pass it directly to `http.createServer` with a stub
 * port.
 */
export const buildControlHandler = (): ((
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>) => handleControlRequest;

/**
 * Boot the control server. Returns a `close()` function the caller
 * can use during graceful shutdown. The port is read once at call
 * time; tests inject their own port via `process.env.SIMULATOR_CONTROL_PORT`.
 */
export const startControlServer = async (port?: number): Promise<{
  readonly port: number;
  readonly close: () => Promise<void>;
}> => {
  const resolvedPort =
    port ??
    (() => {
      const raw = process.env["SIMULATOR_CONTROL_PORT"];
      if (raw === undefined || raw === "") return DEFAULT_CONTROL_PORT;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : DEFAULT_CONTROL_PORT;
    })();

  const server = createHttpServer(buildControlHandler());
  await new Promise<void>((resolve) =>
    server.listen(resolvedPort, "127.0.0.1", () => resolve()),
  );
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { port: resolvedPort, close };
};
