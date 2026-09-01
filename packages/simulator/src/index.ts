/**
 * Surakkha simulator — entry point (Story 2.4 + Story 2.5).
 *
 * Boot sequence:
 *   1. Read + validate `devices.json` (UUIDv4 device_ids, scenarios
 *      in SCENARIO_NAMES, no duplicate UUIDs).
 *   2. Read env: `API_URL` (default `http://localhost:4000`),
 *      `JWT_SECRET` (required, ≥ JWT_SECRET_MIN_LENGTH), optional
 *      `TICK_INTERVAL_MS` (must be ≥ 1000), optional
 *      `SIMULATOR_SECRET` (Story 2.5).
 *   3. Mint one simulator JWT per device.
 *   4. Spawn one `WsClient` per device. The clients[] array is
 *      registered into a module-scoped `clientsRegistry` (Story 2.5)
 *      so the control HTTP server can read it without re-running boot.
 *   5. Boot the control HTTP server (Story 2.5).
 *   6. Wire SIGINT / SIGTERM to graceful shutdown (close all sockets,
 *      drain the per-device buffers, exit code 0).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isUuidV4 } from "@surakkha/shared";
import { createLogger } from "@surakkha/shared/logger";

import { setClientsRegistry, startControlServer } from "./control/server.js";
import { assertJwtSecretOrExit, mintSimulatorTokensForDevices } from "./jwt.js";
import { SCENARIO_NAMES, type ScenarioName } from "./scenarios.js";
import { BUFFER_CAP, MIN_TICK_INTERVAL_MS, WsClient, type WsClientOptions } from "./wsClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger({ name: "surakkha-simulator", level: "info" });

// `readFileSync(__dirname + ...)` keeps the file load deterministic
// regardless of CWD; tests pass a custom path via `loadDevicesFile`.
const DEVICES_FILE_PATH = resolve(__dirname, "devices.json");

export interface DevicesFileShape {
  readonly tick_interval_ms: number;
  readonly devices: ReadonlyArray<{
    readonly device_id: string;
    readonly scenario: string;
  }>;
}

export interface LoadDevicesResult {
  readonly tickIntervalMs: number;
  readonly devices: ReadonlyArray<{
    readonly deviceId: string;
    readonly scenario: ScenarioName;
  }>;
}

/**
 * Hard-exit helper: log a message to stderr and exit code 1. Used by
 * `loadDevicesFile` and `resolveConfig` for fail-fast paths. The
 * eslint disable here is the same pattern the api uses in `assertJwtSecret`
 * — these are boot-time configuration failures, not graceful shutdown.
 */
const failFast = (message: string): never => {
  console.error(message);
  // eslint-disable-next-line no-restricted-properties
  process.exit(1);
  // `process.exit` is typed `never` but the `no-restricted-properties`
  // disable above obscures that; the throw below makes the return type
  // explicit so downstream call-sites narrow.
  throw new Error("process.exit did not terminate the process");
};

/**
 * Load and strictly validate `devices.json`. The "STRENGTHEN upfront
 * validation" review pin (loopback 1) requires:
 *   - every `device_id` is a UUIDv4 string
 *   - every `scenario` is a member of `SCENARIO_NAMES`
 *   - no duplicate `device_id`s
 *   - `tick_interval_ms` >= MIN_TICK_INTERVAL_MS
 *
 * Any failure logs a single clear line and `process.exit(1)`s before
 * any socket is opened. Returning a parsed structure on success keeps
 * the boot path testable.
 */
export const loadDevicesFile = (filePath: string = DEVICES_FILE_PATH): LoadDevicesResult => {
  const obj = readDevicesJsonObject(filePath);
  const tickRaw = readTickIntervalMs(obj);
  const devicesRaw = readDevicesArray(obj);
  return {
    tickIntervalMs: tickRaw,
    devices: validateDevices(devicesRaw),
  };
};

const readDevicesJsonObject = (filePath: string): Record<string, unknown> => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failFast(`simulator: failed to read ${filePath}: ${message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    failFast("simulator: devices.json must be a JSON object");
  }
  return raw as Record<string, unknown>;
};

const readTickIntervalMs = (obj: Record<string, unknown>): number => {
  const tickRaw: unknown = obj["tick_interval_ms"];
  if (typeof tickRaw !== "number" || !Number.isFinite(tickRaw)) {
    failFast("simulator: devices.json missing numeric `tick_interval_ms`");
  }
  // `failFast` is `never`; assert the narrowed type explicitly so
  // tsc sees the post-guard type as `number` (the guard above is a
  // disjunction, so TS keeps `tickRaw` as `unknown` without an
  // explicit cast).
  const tickNum = tickRaw as number;
  if (tickNum < MIN_TICK_INTERVAL_MS) {
    failFast(
      `simulator: devices.json tick_interval_ms=${tickNum} is below minimum ${MIN_TICK_INTERVAL_MS}`,
    );
  }
  return tickNum;
};

const readDevicesArray = (obj: Record<string, unknown>): unknown[] => {
  const devicesRaw: unknown = obj["devices"];
  if (!Array.isArray(devicesRaw) || devicesRaw.length === 0) {
    failFast("simulator: devices.json missing non-empty `devices` array");
  }
  return devicesRaw as unknown[];
};

const validateDevices = (
  devicesRaw: readonly unknown[],
): Array<{ readonly deviceId: string; readonly scenario: ScenarioName }> => {
  const seen = new Set<string>();
  const validated: Array<{ readonly deviceId: string; readonly scenario: ScenarioName }> = [];
  for (const [index, entry] of devicesRaw.entries()) {
    if (typeof entry !== "object" || entry === null) {
      failFast(`simulator: devices.json devices[${index}] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    const deviceIdRaw: unknown = e["device_id"];
    const scenarioRaw: unknown = e["scenario"];
    if (!isUuidV4(deviceIdRaw)) {
      failFast(
        `simulator: devices.json devices[${index}].device_id must be a UUIDv4 (got ${String(deviceIdRaw)})`,
      );
    }
    const deviceId = deviceIdRaw as string;
    if (seen.has(deviceId)) {
      failFast(`simulator: devices.json devices[${index}].device_id "${deviceId}" is a duplicate`);
    }
    if (typeof scenarioRaw !== "string" || !SCENARIO_NAMES.includes(scenarioRaw as ScenarioName)) {
      failFast(
        `simulator: devices.json devices[${index}].scenario "${String(scenarioRaw)}" is not in SCENARIO_NAMES (${SCENARIO_NAMES.join(", ")})`,
      );
    }
    seen.add(deviceId);
    validated.push({ deviceId, scenario: scenarioRaw as ScenarioName });
  }
  return validated;
};

/**
 * Parse `API_URL` and `TICK_INTERVAL_MS` env vars. `API_URL` must be
 * a parseable URL with `http` or `https` protocol. `TICK_INTERVAL_MS`
 * must be a number ≥ MIN_TICK_INTERVAL_MS.
 *
 * Returns either the parsed values or a `null` + an exit on failure.
 */
export interface ResolvedConfig {
  readonly apiUrl: string;
  /**
   * Resolved tick interval from the env, or `undefined` if the env var
   * was unset/empty (caller falls back to devices.json's value). The
   * `undefined` sentinel — not a magic `DEFAULT_TICK_INTERVAL_MS`
   * boundary check — is what makes the env-wins-or-file-fallback
   * precedence unambiguous.
   */
  readonly tickIntervalMs: number | undefined;
}

export const resolveConfig = (): ResolvedConfig => {
  const apiUrl = resolveApiUrl();
  const tickIntervalMs = resolveTickIntervalMs();
  return { apiUrl, tickIntervalMs };
};

const resolveApiUrl = (): string => {
  const apiUrl = process.env["API_URL"] ?? "http://localhost:4000";
  try {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`unsupported protocol: ${parsed.protocol}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failFast(`simulator: API_URL is invalid: ${message}`);
  }
  // `failFast` is `never` but the type guard above doesn't narrow it.
  return apiUrl;
};

/**
 * Resolve `TICK_INTERVAL_MS`. Returns `undefined` if the env var is
 * unset or empty (so the caller can fall back to devices.json), or a
 * validated number if it was set. Throws via `failFast` on bad input.
 */
const resolveTickIntervalMs = (): number | undefined => {
  const envTick = process.env["TICK_INTERVAL_MS"];
  if (envTick === undefined || envTick === "") {
    return undefined;
  }
  const n = Number.parseInt(envTick, 10);
  if (!Number.isFinite(n) || n < MIN_TICK_INTERVAL_MS) {
    failFast(
      `simulator: TICK_INTERVAL_MS=${envTick} is invalid (must be integer >= ${MIN_TICK_INTERVAL_MS})`,
    );
  }
  return n;
};

/**
 * Boot the simulator. Exposed for tests so they can run the boot
 * sequence against a stubbed env without spawning a child process.
 */
export const boot = (): void => {
  // 1. Env: JWT_SECRET (fail-fast).
  const secret = assertJwtSecretOrExit();

  // 2. devices.json.
  const { devices, tickIntervalMs: fileTickMs } = loadDevicesFile();

  // 3. API_URL + env TICK_INTERVAL_MS.
  const cfg = resolveConfig();

  // 4. JWTs.
  const deviceIds = devices.map((d) => d.deviceId);
  const tokens = mintSimulatorTokensForDevices(deviceIds);

  logger.info(
    {
      deviceCount: devices.length,
      bufferCap: BUFFER_CAP,
      tickIntervalMs: cfg.tickIntervalMs,
      apiUrl: cfg.apiUrl,
    },
    "simulator: boot",
  );

  // 5. Spawn one WsClient per device. The env TICK_INTERVAL_MS
  //    overrides the per-file value when set; otherwise the file
  //    value is used.
  const clients: WsClient[] = [];
  for (const { deviceId, scenario } of devices) {
    const token = tokens.get(deviceId);
    if (token === undefined) {
      // unreachable: loadDevicesFile validated uniqueness
      throw new Error(`simulator: missing token for device ${deviceId}`);
    }
    // Env wins when set (returns a number); otherwise fall back to the
    // devices.json value. Both branches are already validated to be
    // ≥ MIN_TICK_INTERVAL_MS upstream — no extra clamp needed.
    const tickIntervalMs = cfg.tickIntervalMs ?? fileTickMs;
    const opts: WsClientOptions = {
      deviceId,
      scenario,
      apiUrl: cfg.apiUrl,
      token,
      tickIntervalMs,
      logger,
    };
    const client = new WsClient(opts);
    clients.push(client);
    client.start();
  }

  // 5b. Story 2.5 — publish the client registry so the control HTTP
  // server can read it without re-running boot(). Lifted from the
  // closure for module scope (the registry is read-only after boot
  // completes; the only writes are the in-loop `setScenario` /
  // `setPaused` calls from the control server).
  // The structural type mirrors `control/server.ts:SimulatorClientLike`
  // exactly so we don't need a type-only import from that module
  // (which would force us to mix `import type` into a sibling import
  // and trip eslint's import/order + no-duplicate-imports rules).
  interface RegistryClient {
    setScenario(name: ScenarioName): void;
    setPaused(paused: boolean): void;
  }
  const registryEntries: Array<[string, RegistryClient]> = [];
  for (const c of clients) {
    registryEntries.push([c.deviceId(), c]);
  }
  setClientsRegistry(new Map(registryEntries));

  // 5c. Story 2.5 — boot the control server. Capture the `close`
  // handle so SIGINT/SIGTERM can shut the port down cleanly (without
  // it, the port leaks and the admin tab stays open for new requests
  // after the simulator stops emitting). EADDRINUSE is the only
  // fatal startup error: it means the admin tab can NEVER come up,
  // so we hard-exit rather than running silently broken. Other
  // errors (permission denied, etc.) stay as warnings — the simulator
  // is still emitting frames.
  //
  // `boot()` is intentionally synchronous (`(): void`), so we wrap the
  // async startup path in an IIFE rather than leaking a Promise out of
  // the public surface.
  let closeControlServer: (() => Promise<void>) | null = null;
  void (async () => {
    try {
      const handle = await startControlServer();
      closeControlServer = handle.close;
      logger.info({ port: handle.port }, "simulator: control server listening");
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      if (errObj.code === "EADDRINUSE") {
        logger.error(
          { err: errObj.message ?? String(err) },
          "simulator: control server port already in use — exiting",
        );
        // Stop the already-started WsClients so we don't leave zombie
        // connections on the api side.
        for (const c of clients) {
          c.stop();
        }
        // eslint-disable-next-line no-restricted-properties
        process.exit(1);
      }
      logger.warn({ err }, "simulator: control server failed to start");
    }
  })();

  // 6. Graceful shutdown.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "simulator: shutdown requested");
    for (const c of clients) {
      c.stop();
    }
    // Close the control HTTP server (if it ever came up) so the
    // port is freed and no further admin requests are accepted
    // after the simulator has stopped emitting. Wrap in try/catch
    // because `close()` may throw if the server was already closed
    // (e.g. boot-time failure left it in a half-open state).
    if (closeControlServer !== null) {
      void closeControlServer().catch((err: unknown) => {
        logger.warn({ err }, "simulator: control server close threw");
      });
    }
    logger.info("simulator: shutdown complete");
    // eslint-disable-next-line no-restricted-properties
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Surface unhandled errors as a fail-fast log + non-zero exit. We
  // do NOT swallow them — the spec's fail-fast posture covers
  // boot-time misconfiguration, but unhandled async errors at
  // runtime should still produce a non-zero exit.
  process.on("unhandledRejection", (err) => {
    logger.error({ err }, "simulator: unhandledRejection");
    // eslint-disable-next-line no-restricted-properties
    process.exit(1);
  });
  // `secret` is read at boot to fail-fast; we don't need the value
  // after `mintSimulatorTokensForDevices` consumed it via env.
  void secret;
};

// Only run the boot when invoked as the entry point (not when
// imported by tests). We resolve both `process.argv[1]` and our own
// `import.meta.url` to absolute paths before comparing, so the check
// works under `tsx` (where argv[1] is the tsx wrapper script, not the
// simulator file) AND under `tsc`-compiled dist/ (where argv[1] is the
// dist/index.js path).
const isEntryPoint = (() => {
  if (typeof process === "undefined") return false;
  const argv1 = process.argv[1];
  if (typeof argv1 !== "string") return false;
  try {
    return resolve(argv1) === __filename;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  boot();
}
