/**
 * Smoke tests for `@surakkha/shared`.
 *
 * These exist so F-0.2's "pnpm -F shared test runs (even if no tests)"
 * acceptance criterion is met and stays met as the package grows.
 */
import { describe, expect, it } from "vitest";

import {
  IncidentStateSchema,
  TelemetryFrameSchema,
  projectKanbanColumn,
} from "./index.js";

describe("telemetry frame schema", () => {
  it("accepts a valid v1 frame", () => {
    const result = TelemetryFrameSchema.safeParse({
      version: 1,
      device_id: "11111111-1111-4111-8111-111111111111",
      ts: 1_700_000_000_000,
      fw: "1.0.0",
      seq: 0,
      metrics: {
        ph: 7.2,
        tds_ppm: 280,
        turbidity_ntu: 1.1,
        temp_c: 24,
        chlorine_ppm: 0.6,
        water_level_cm: 120,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a frame with version !== 1", () => {
    const result = TelemetryFrameSchema.safeParse({
      version: 2,
      device_id: "11111111-1111-4111-8111-111111111111",
      ts: 1_700_000_000_000,
      fw: "1.0.0",
      seq: 0,
      metrics: {
        ph: 7.2,
        tds_ppm: 280,
        turbidity_ntu: 1.1,
        temp_c: 24,
        chlorine_ppm: 0.6,
        water_level_cm: 120,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range pH", () => {
    const result = TelemetryFrameSchema.safeParse({
      version: 1,
      device_id: "11111111-1111-4111-8111-111111111111",
      ts: 1_700_000_000_000,
      fw: "1.0.0",
      seq: 0,
      metrics: {
        ph: 16,
        tds_ppm: 280,
        turbidity_ntu: 1.1,
        temp_c: 24,
        chlorine_ppm: 0.6,
        water_level_cm: 120,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("incident state machine", () => {
  it("lists all eight states", () => {
    expect(IncidentStateSchema.options).toEqual([
      "OPEN",
      "ACKNOWLEDGED",
      "INSPECTING",
      "SAFE",
      "UNSAFE",
      "MONITORING",
      "RESOLVED",
      "REOPENED",
    ]);
  });

  it("projects OPEN warning to OPEN_WARNING column", () => {
    expect(projectKanbanColumn("OPEN", "warning")).toBe("OPEN_WARNING");
  });

  it("projects OPEN critical to OPEN_CRITICAL column", () => {
    expect(projectKanbanColumn("OPEN", "critical")).toBe("OPEN_CRITICAL");
  });

  it("projects RESOLVED to RESOLVED column regardless of severity", () => {
    expect(projectKanbanColumn("RESOLVED", "info")).toBe("RESOLVED");
  });

  it("projects ACKNOWLEDGED to ACKNOWLEDGED column", () => {
    expect(projectKanbanColumn("ACKNOWLEDGED", "warning")).toBe("ACKNOWLEDGED");
  });
});