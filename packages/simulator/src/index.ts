/**
 * Surakkha simulator — entry point.
 *
 * Boots the telemetry simulator: mints a JWT per device, opens a WebSocket
 * to `/ingest/{device_id}` on the api, emits frames at the configured rate,
 * and runs the active scenario per device.
 *
 * Real implementation lands in Story 2.4 (Simulator Process + Six Default
 * Devices + Seven Scenarios). This stub exists so the package builds.
 */

import { createLogger } from "@surakkha/shared/logger";

const logger = createLogger({ name: "surakkha-simulator", level: "info" });

logger.info(
  {
    build: "stub",
    note: "Story 2.4 will replace this with the simulator process.",
  },
  "simulator: boot",
);

export {};
