/**
 * `docker-compose.dev.yml` simulator env contract.
 *
 * The simulator reads `process.env["API_URL"]`
 * (packages/simulator/src/index.ts:210) for its Socket.IO ingest
 * URL. A previous version of this compose file set `SIMULATOR_API_URL`
 * instead; the simulator silently fell back to its
 * `http://localhost:4000` default, every device emitted
 * `connect_error`, and the stack looked "running" while producing no
 * telemetry.
 *
 * This source-walk contract pin asserts:
 *   1. The simulator source uses `process.env["API_URL"]` (NOT
 *      `SIMULATOR_API_URL`).
 *   2. The compose file sets `API_URL:` (NOT `SIMULATOR_API_URL:`)
 *      on the `simulator` service.
 *
 * Mirrors the shape of
 *   packages/api/__tests__/health.public.spec.ts
 *   packages/web/src/__tests__/nginx.routes.spec.ts
 *   packages/simulator/src/__tests__/dockerfile.devicesJson.spec.ts
 * — text-shape, no runtime required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Spec lives at
// packages/simulator/src/__tests__/envContract.spec.ts.
// Simulator source: ../../src/index.ts (two levels up from __tests__).
// Compose:            ../../../../docker-compose.dev.yml (four levels up
//                     from __tests__).
const HERE = dirname(fileURLToPath(import.meta.url));
const SIMULATOR_INDEX_PATH = join(HERE, "..", "index.ts");
const COMPOSE_PATH = join(HERE, "..", "..", "..", "..", "docker-compose.dev.yml");

const readSimulatorIndex = (): string => readFileSync(SIMULATOR_INDEX_PATH, "utf8");
const readCompose = (): string => readFileSync(COMPOSE_PATH, "utf8");

describe("simulator API_URL env contract", () => {
  const simulatorSrc = readSimulatorIndex();
  const compose = readCompose();

  it("simulator reads `API_URL` from process.env", () => {
    // The contract is set in
    // packages/simulator/src/index.ts around line 210
    // (resolveApiUrl helper). Pin the env name so the contract is
    // explicit.
    expect(simulatorSrc).toMatch(/process\.env\["API_URL"\]/);
  });

  it("simulator does NOT read `SIMULATOR_API_URL`", () => {
    // Belt and braces: prevent the wrong-name regression from
    // re-appearing in either direction.
    expect(simulatorSrc).not.toMatch(/process\.env\["SIMULATOR_API_URL"\]/);
    expect(simulatorSrc).not.toMatch(/process\.env\["simulator_api_url"\]/i);
  });

  it("compose sets `API_URL` on the simulator service", () => {
    // Match a `simulator:` service block followed by an indented
    // `API_URL:` key. The block may contain other env entries; we
    // just need to confirm the key is present.
    const simulatorBlock = compose.match(
      /^\s{2}simulator:\s*\n[\s\S]*?(?=^\s{2}\w|^$)/m,
    );
    expect(simulatorBlock).not.toBeNull();
    expect(simulatorBlock![0]).toMatch(/^\s{6}API_URL:\s+\S+/m);
  });

  it("compose does NOT set `SIMULATOR_API_URL` as an env key", () => {
    // Strip YAML comments so a `NOT SIMULATOR_API_URL` comment
    // explaining the wrong-name fix doesn't trip the assertion.
    // We pin the absence of the env *key* (line starts with
    // whitespace + `SIMULATOR_API_URL:`).
    const uncommented = compose
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(uncommented).not.toMatch(/^\s*SIMULATOR_API_URL\s*:/m);
  });
});
