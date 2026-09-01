/**
 * `csvSerialization.spec.ts` — Story 5.2 (F1 follow-up).
 *
 * Pure unit-tests for `encodeCsvCell` and `readingRowToCsvLines`.
 * The router-level integration test in `csvRouter.spec.ts` exercises
 * the wire shape end-to-end, but the helper module is the load-
 * bearing seam for RFC 4180 quoting + forward-compat metric
 * iteration; pinning the helpers directly means a regression in
 * either pure function fails at the closest possible test seam.
 *
 * Coverage map (one assertion per case):
 *   1. plain numeric value  → emitted unquoted (RFC 4180 §2.1).
 *   2. plain string value   → emitted unquoted.
 *   3. value with comma     → quoted (`"x,y"`).
 *   4. value with quote     → quoted + doubled (`"a""b"`).
 *   5. value with newline   → quoted (`"a\nb"`).
 *   6. value with CR        → quoted (`"a\rb"`).
 *   7. value with all 3     → quoted + doubled (`"x""y\nz"`).
 *   8. numeric value        → `String(num)` (e.g. `7.5`, not `"7.5"`).
 *
 * Plus `readingRowToCsvLines`:
 *   9. emits one line per metric key in the row.
 *  10. emits lines in canonical `MetricKeySchema.options` order
 *      (so a downstream diff stays deterministic).
 *  11. emits the 6 known v1 metrics + any v2 7th metric (F11
 *      forward-compat — the new code iterates `Object.entries`).
 *  12. malformed `metrics` (a string where a number is expected)
 *      produces ZERO lines + a stderr warning (F12 — skip rather
 *      than crash).
 */
import { describe, expect, it, vi } from "vitest";

import { type ReadingRow } from "./csvRepository.js";
import { CSV_HEADER, encodeCsvCell, readingRowToCsvLines } from "./csvSerialization.js";

const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000001";

const baseRow = (overrides: Partial<ReadingRow> = {}): ReadingRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  deviceId: DEVICE_ID,
  ts: new Date("2026-08-01T00:00:00.000Z"),
  metrics: {
    ph: 7.0,
    tds_ppm: 100,
    turbidity_ntu: 0.5,
    temp_c: 27.0,
    chlorine_ppm: 0.6,
    water_level_cm: 80,
  },
  ...overrides,
});

describe("encodeCsvCell — RFC 4180 quoting", () => {
  it("returns plain numeric values unquoted (case 1)", () => {
    expect(encodeCsvCell(7)).toBe("7");
    expect(encodeCsvCell(7.5)).toBe("7.5");
    expect(encodeCsvCell(0)).toBe("0");
  });

  it("returns plain string values unquoted (case 2)", () => {
    expect(encodeCsvCell("hello")).toBe("hello");
    expect(encodeCsvCell("a-b_c.d")).toBe("a-b_c.d");
  });

  it("quotes a value containing a comma (case 3)", () => {
    expect(encodeCsvCell("x,y")).toBe('"x,y"');
  });

  it("quotes + doubles a value containing a quote (case 4)", () => {
    expect(encodeCsvCell('a"b')).toBe('"a""b"');
  });

  it("quotes a value containing a newline (case 5)", () => {
    expect(encodeCsvCell("a\nb")).toBe('"a\nb"');
  });

  it("quotes a value containing a CR (case 6)", () => {
    expect(encodeCsvCell("a\rb")).toBe('"a\rb"');
  });

  it("quotes + doubles a value containing all three triggers (case 7)", () => {
    expect(encodeCsvCell('x"y\nz')).toBe('"x""y\nz"');
  });

  it("stringifies numeric values via String() (case 8)", () => {
    // Pin the numeric coercion explicitly: numbers become strings
    // before any quoting rule, so `NaN` → `"NaN"`. The router
    // guards NaN at the F11 boundary so it never reaches here.
    expect(encodeCsvCell(-1.5)).toBe("-1.5");
    expect(encodeCsvCell(1_000)).toBe("1000");
  });
});

describe("readingRowToCsvLines — header + per-metric layout", () => {
  it("CSV_HEADER is the canonical header line", () => {
    expect(CSV_HEADER).toBe("device_id,ts,metric,value");
  });

  it("emits one line per metric key in the row (case 9)", () => {
    const lines = readingRowToCsvLines(baseRow());
    // 6 v1 metric keys = 6 lines.
    expect(lines).toHaveLength(6);
  });

  it("emits lines in canonical MetricKeySchema.options order (case 10)", () => {
    const lines = readingRowToCsvLines(baseRow());
    const expectedKeyOrder = [
      "ph",
      "tds_ppm",
      "turbidity_ntu",
      "temp_c",
      "chlorine_ppm",
      "water_level_cm",
    ];
    for (let i = 0; i < expectedKeyOrder.length; i += 1) {
      const parts = lines[i]!.split(",");
      // parts[2] is the `metric` column.
      expect(parts[2]).toBe(expectedKeyOrder[i]!);
    }
  });

  it("emits a v2 7th metric key in addition to the 6 v1 keys (F11 forward-compat)", () => {
    // F11 — ADR 0001 promises forward-compat. The new
    // `Object.entries`-based iteration should surface a 7th
    // metric key (`orp_mv`) so the operator's CSV isn't silently
    // missing new data.
    const row = baseRow({
      // Cast through unknown so the 7th key bypasses the strict
      // v1 `TelemetryMetrics` type but is still iterable by the
      // serializer.
      metrics: {
        ph: 7.0,
        tds_ppm: 100,
        turbidity_ntu: 0.5,
        temp_c: 27.0,
        chlorine_ppm: 0.6,
        water_level_cm: 80,
        orp_mv: 250 as any,
      } as unknown as ReadingRow["metrics"],
    });
    const lines = readingRowToCsvLines(row);
    expect(lines).toHaveLength(7);
    // The 7th line is the v2 metric.
    expect(lines[6]).toContain(",orp_mv,");
  });

  it("skips malformed metrics and emits 0 lines (F12 — no crash)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const row = baseRow({
      // String where a number is expected → `TelemetryMetricsSchema`
      // rejects the whole metrics object → row is skipped.
      metrics: {
        ph: "not a number",
        tds_ppm: 100,
        turbidity_ntu: 0.5,
        temp_c: 27.0,
        chlorine_ppm: 0.6,
        water_level_cm: 80,
      } as unknown as ReadingRow["metrics"],
    });
    const lines = readingRowToCsvLines(row);
    expect(lines).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
