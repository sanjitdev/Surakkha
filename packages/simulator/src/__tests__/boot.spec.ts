/**
 * Story 2.4 — boot fail-fast tests.
 *
 * Pins the spec's "boot must fail fast on misconfiguration" contract
 * without spawning a child process. Each test writes a temp
 * `devices.json` and injects env vars via `process.env`; the boot
 * helpers in `index.ts` and `jwt.ts` are exercised directly.
 *
 * Covers (loopback-1):
 *   - missing JWT_SECRET → exit code 1
 *   - bad API_URL → exit code 1
 *   - happy path → mints six JWTs
 *   - malformed devices.json → exit code 1
 *   - unknown scenario name → exit code 1
 *   - duplicate device_id → exit code 1
 *   - TICK_INTERVAL_MS out-of-range → exit code 1
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JWT_SECRET_MIN_LENGTH } from "@surakkha/shared/auth";

import {
  loadDevicesFile,
  resolveConfig,
} from "../index.js";
import {
  assertJwtSecretOrExit,
  mintSimulatorTokensForDevices,
} from "../jwt.js";

const VALID_DEVICES_JSON = {
  tick_interval_ms: 2000,
  devices: [
    { device_id: "9b1c4f00-0000-4000-8000-000000000001", scenario: "Normal" },
    { device_id: "9b1c4f00-0000-4000-8000-000000000002", scenario: "RisingTDS" },
    { device_id: "9b1c4f00-0000-4000-8000-000000000003", scenario: "TurbiditySpike" },
    { device_id: "9b1c4f00-0000-4000-8000-000000000004", scenario: "ChlorineDrop" },
    { device_id: "9b1c4f00-0000-4000-8000-000000000005", scenario: "Offline" },
    { device_id: "9b1c4f00-0000-4000-8000-000000000006", scenario: "RandomFailure" },
  ],
};

let tmpDir: string;
let previousEnv: Record<string, string | undefined> = {};

const saveEnv = (): void => {
  previousEnv = {
    JWT_SECRET: process.env["JWT_SECRET"],
    API_URL: process.env["API_URL"],
    TICK_INTERVAL_MS: process.env["TICK_INTERVAL_MS"],
  };
};

const restoreEnv = (): void => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const writeDevicesJson = (body: unknown): string => {
  const path = join(tmpDir, "devices.json");
  writeFileSync(path, JSON.stringify(body), "utf8");
  return path;
};

const trapExit = (): { spy: ReturnType<typeof vi.spyOn> } => {
  const spy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? "undefined"})`);
  }) as never);
  return { spy };
};

beforeEach(() => {
  saveEnv();
  tmpDir = mkdtempSync(join(tmpdir(), "surakkha-simulator-test-"));
  process.env["JWT_SECRET"] = "x".repeat(JWT_SECRET_MIN_LENGTH);
});

afterEach(() => {
  restoreEnv();
  if (tmpDir !== "") {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("boot — fail-fast paths", () => {
  it("exits non-zero when JWT_SECRET is unset", () => {
    delete process.env["JWT_SECRET"];
    const { spy: exitSpy } = trapExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => assertJwtSecretOrExit()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits non-zero when JWT_SECRET is below the min length", () => {
    process.env["JWT_SECRET"] = "short";
    const { spy: exitSpy } = trapExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => assertJwtSecretOrExit()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits non-zero when API_URL is malformed", () => {
    process.env["API_URL"] = "not-a-url-without-protocol";
    const { spy: exitSpy } = trapExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => resolveConfig()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits non-zero when TICK_INTERVAL_MS is below MIN_TICK_INTERVAL_MS", () => {
    process.env["TICK_INTERVAL_MS"] = "500";
    const { spy: exitSpy } = trapExit();
    expect(() => resolveConfig()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits non-zero when TICK_INTERVAL_MS is non-numeric", () => {
    process.env["TICK_INTERVAL_MS"] = "not-a-number";
    const { spy: exitSpy } = trapExit();
    expect(() => resolveConfig()).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits non-zero when devices.json is malformed (not parseable JSON)", () => {
    const path = join(tmpDir, "devices.json");
    writeFileSync(path, "not valid json", "utf8");
    const { spy: exitSpy } = trapExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => loadDevicesFile(path)).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits non-zero when devices.json has an unknown scenario name", () => {
    const path = writeDevicesJson({
      tick_interval_ms: 2000,
      devices: [
        { device_id: "9b1c4f00-0000-4000-8000-000000000001", scenario: "NoSuchScenario" },
      ],
    });
    const { spy: exitSpy } = trapExit();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => loadDevicesFile(path)).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exits non-zero when devices.json has a duplicate device_id", () => {
    const path = writeDevicesJson({
      tick_interval_ms: 2000,
      devices: [
        { device_id: "9b1c4f00-0000-4000-8000-000000000001", scenario: "Normal" },
        { device_id: "9b1c4f00-0000-4000-8000-000000000001", scenario: "RisingTDS" },
      ],
    });
    const { spy: exitSpy } = trapExit();
    expect(() => loadDevicesFile(path)).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits non-zero when devices.json contains a non-UUIDv4 device_id", () => {
    const path = writeDevicesJson({
      tick_interval_ms: 2000,
      devices: [
        { device_id: "not-a-uuid", scenario: "Normal" },
      ],
    });
    const { spy: exitSpy } = trapExit();
    expect(() => loadDevicesFile(path)).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits non-zero when devices.json has tick_interval_ms below MIN_TICK_INTERVAL_MS", () => {
    const path = writeDevicesJson({
      tick_interval_ms: 500,
      devices: [
        { device_id: "9b1c4f00-0000-4000-8000-000000000001", scenario: "Normal" },
      ],
    });
    const { spy: exitSpy } = trapExit();
    expect(() => loadDevicesFile(path)).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits non-zero when devices.json has an empty devices array", () => {
    const path = writeDevicesJson({ tick_interval_ms: 2000, devices: [] });
    const { spy: exitSpy } = trapExit();
    expect(() => loadDevicesFile(path)).toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("boot — happy path validation", () => {
  it("loadDevicesFile parses a valid file with six devices", () => {
    const path = writeDevicesJson(VALID_DEVICES_JSON);
    const result = loadDevicesFile(path);
    expect(result.tickIntervalMs).toBe(2000);
    expect(result.devices).toHaveLength(6);
    expect(result.devices.map((d) => d.scenario)).toEqual([
      "Normal",
      "RisingTDS",
      "TurbiditySpike",
      "ChlorineDrop",
      "Offline",
      "RandomFailure",
    ]);
    for (const d of result.devices) {
      expect(d.deviceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("mintSimulatorTokensForDevices returns six tokens for six devices", () => {
    const ids = VALID_DEVICES_JSON.devices.map((d) => d.device_id);
    const tokens = mintSimulatorTokensForDevices(ids);
    expect(tokens.size).toBe(6);
  });
});

describe("boot — default devices.json in repo is valid", () => {
  it("ships six UUIDv4 devices with scenarios covering six of seven SCENARIO_NAMES", async () => {
    // Use a top-level import (json) since the simulator's tsconfig
    // has `resolveJsonModule: true` inherited from the base.
    const { default: devicesJson } = await import(
      "../devices.json",
      { with: { type: "json" } }
    ) as { default: { tick_interval_ms: number; devices: Array<{ device_id: string; scenario: string }> } };
    expect(devicesJson.tick_interval_ms).toBeGreaterThanOrEqual(1000);
    expect(devicesJson.devices).toHaveLength(6);
    const scenarios = new Set(devicesJson.devices.map((d) => d.scenario));
    // Six of seven — BatteryLow is the spare (no device is assigned
    // it because BatteryLow is a log-only signal in v1).
    expect(scenarios.has("BatteryLow")).toBe(false);
    expect(scenarios.size).toBe(6);
    // Pin the exact six assigned — not just the size — so a typo
    // (e.g. "TurbidtySpike") or a 5-unique-1-repeat mapping is
    // caught.
    const expectedScenarios = new Set([
      "Normal",
      "RisingTDS",
      "TurbiditySpike",
      "ChlorineDrop",
      "Offline",
      "RandomFailure",
    ]);
    expect(scenarios).toEqual(expectedScenarios);
    for (const d of devicesJson.devices) {
      expect(d.device_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });
});
