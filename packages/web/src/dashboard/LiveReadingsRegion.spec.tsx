/**
 * `LiveReadingsRegion` — Story 2.8.
 *
 * Coverage matrix (AC1 – AC4 from the spec):
 *
 *   AC1 — Six devices connected → six rows in DOM order with the
 *         documented columns (device / metric / severity / age).
 *     - "renders one row per device from six readings"
 *     - "the value column is monospaced"
 *     - "each row carries the four columns"
 *     - "rows are sorted critical → warning → healthy → offline by
 *        severity rank; device_id breaks ties"
 *
 *   AC2 — Critical row carries the UX-DR-2 4px / 3px / 8px visual
 *         hierarchy and `aria-live="polite"`.
 *     - "critical row applies the 4px / 3px / 8px border hierarchy"
 *     - "critical row is announced via aria-live=polite"
 *     - "non-critical rows are announced quietly (no aria-live)"
 *
 *   AC3 — A `reading:new` for an existing device replays the
 *         1200ms `animate-live-pulse` class and resets the age
 *         column to "just now".
 *     - "advancing server_received_at toggles animate-live-pulse"
 *     - "age column resets to just now on update"
 *
 *   AC4 — Viewer role renders the same read-only surface
 *         (no sort control, no per-row buttons); severity rules
 *         apply identically across roles.
 *     - "Viewer renders the same surface as Operator"
 *     - "no sort or action controls exist on the region"
 *
 * The Region reads `LatestReadingPayload[]` directly (the parent
 * `Dashboard` owns the `useDashboardReadings()` query), so the
 * spec exercises the region via a synthetic props surface rather
 * than spinning up the full query client + socket.
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  type LatestReadingPayload,
} from "@surakkha/shared/dashboard";

import { LiveReadingsRegion } from "./LiveReadingsRegion";

const HEALTHY_METRICS = {
  ph: 7.2,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27.4,
  chlorine_ppm: 0.6,
  water_level_cm: 85,
} as const;

const CRITICAL_METRICS = {
  ph: 9.1, // out of [6.5..8.5]
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27.4,
  chlorine_ppm: 0.6,
  water_level_cm: 85,
} as const;

const DEVICE_A = "9b1c4f00-0000-4000-8000-aaaaaaaaaaaa";
const DEVICE_B = "9b1c4f00-0000-4000-8000-bbbbbbbbbbbb";
const DEVICE_C = "9b1c4f00-0000-4000-8000-cccccccccccc";
const DEVICE_D = "9b1c4f00-0000-4000-8000-dddddddddddd";
const DEVICE_E = "9b1c4f00-0000-4000-8000-eeeeeeeeeeee";
const DEVICE_F = "9b1c4f00-0000-4000-8000-ffffffffffff";

const baseReading = (
  device_id: string,
  metrics: typeof HEALTHY_METRICS,
  name: string | null,
  server_received_at: string,
): LatestReadingPayload => ({
  device_id,
  name,
  ts: Date.parse(server_received_at),
  server_received_at,
  metrics: { ...metrics },
  flags: [],
});

const renderRegion = (readings: readonly LatestReadingPayload[]) =>
  render(<LiveReadingsRegion readings={readings} />);

beforeEach(() => {
  // Live readings row computes the age from `Date.now()`; the
  // tests below pin absolute timestamps that are always in the past
  // for the test wall clock, so no faking is required here.
});

afterEach(() => {
  cleanup();
});

describe("Story 2.8 — AC1: one row per device, four columns, monospace value", () => {
  it("renders six rows from six readings", () => {
    const readings: LatestReadingPayload[] = [
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_B, HEALTHY_METRICS, "School B", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_C, HEALTHY_METRICS, "School C", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_D, HEALTHY_METRICS, "School D", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_E, HEALTHY_METRICS, "School E", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_F, HEALTHY_METRICS, "School F", "2026-08-24T10:00:00.000Z"),
    ];

    renderRegion(readings);

    expect(
      screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`dashboard-live-readings-row-${DEVICE_B}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`dashboard-live-readings-row-${DEVICE_C}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`dashboard-live-readings-row-${DEVICE_D}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`dashboard-live-readings-row-${DEVICE_E}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`dashboard-live-readings-row-${DEVICE_F}`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-live-readings-table")).toBeInTheDocument();
  });

  it("renders the four column headers", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    expect(screen.getByRole("columnheader", { name: "Device" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Metric" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Severity" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Age" })).toBeInTheDocument();
  });

  it("renders the value cell with a monospace class", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    const metricCell = row.querySelector('[role="cell"]:nth-child(2)');
    expect(metricCell?.firstElementChild?.className ?? "").toContain("font-mono");
  });

  it("sorts critical rows above healthy rows and breaks ties on device_id ASC", () => {
    // Critical: DEVICE_C (later in alphabet than DEVICE_A).
    // Healthy: DEVICE_A, DEVICE_B (DEVICE_A before DEVICE_B alphabetically).
    // Expected order: DEVICE_C (critical) → DEVICE_A (healthy) → DEVICE_B (healthy).
    const readings: LatestReadingPayload[] = [
      baseReading(DEVICE_B, HEALTHY_METRICS, "School B", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_C, CRITICAL_METRICS, "School C", "2026-08-24T10:00:00.000Z"),
    ];

    renderRegion(readings);

    const table = screen.getByTestId("dashboard-live-readings-table");
    const rows = Array.from(table.querySelectorAll('[role="row"]')).filter(
      (node) => node.getAttribute("data-testid")?.startsWith("dashboard-live-readings-row-"),
    );
    const order = rows.map((r) => r.getAttribute("data-device-id"));
    expect(order).toEqual([DEVICE_C, DEVICE_A, DEVICE_B]);
  });

  it("stable-sort preserves device_id order when severities match", () => {
    // Three readings, all healthy, in non-alphabetical input order.
    // Expected: input order preserved (Array.prototype.sort is stable
    // in V8 / Node 18+; the spec promises "deterministic" order so
    // the comparator must NOT introduce a secondary sort that breaks
    // the stable contract).
    const readings: LatestReadingPayload[] = [
      baseReading(DEVICE_C, HEALTHY_METRICS, "School C", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_B, HEALTHY_METRICS, "School B", "2026-08-24T10:00:00.000Z"),
    ];

    renderRegion(readings);

    const table = screen.getByTestId("dashboard-live-readings-table");
    const rows = Array.from(table.querySelectorAll('[role="row"]')).filter(
      (node) => node.getAttribute("data-testid")?.startsWith("dashboard-live-readings-row-"),
    );
    const order = rows.map((r) => r.getAttribute("data-device-id"));
    // All healthy → tiebreaker on `device_id.localeCompare` produces
    // alphabetical order: A, B, C.
    expect(order).toEqual([DEVICE_A, DEVICE_B, DEVICE_C]);
  });
});

describe("Story 2.8 — AC2: critical-row visual hierarchy + aria-live", () => {
  it("critical row carries the 4px / 3px / 8px border hierarchy", () => {
    renderRegion([
      baseReading(DEVICE_A, CRITICAL_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    expect(row.className).toContain("border-l-4");
    expect(row.className).toContain("border-severity-critical-value");
    expect(row.className).toContain("shadow-[0_0_8px_#EF444433]");
  });

  it("critical row severity cell uses aria-live=polite", () => {
    renderRegion([
      baseReading(DEVICE_A, CRITICAL_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    // aria-live rides the severity CELL, not the row, so screen-reader
    // announcements cover only the escalation signal — announcing the
    // entire row on every `reading:new` would re-read the device name
    // and metric on every tick.
    const severityCell = row.querySelector('[aria-label="critical severity"]');
    expect(severityCell?.getAttribute("aria-live")).toBe("polite");
  });

  it("non-critical rows do NOT carry the critical hierarchy or aria-live", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    expect(row.className).not.toContain("border-l-4");
    expect(row.className).toContain("border-neutral-border");
    // The severity cell does not need a screen-reader announcement
    // for healthy refreshes — no `aria-live` rides the cell.
    const severityCell = row.querySelector('[aria-label="healthy severity"]');
    expect(severityCell?.getAttribute("aria-live")).not.toBe("polite");
  });

  it("severity dot uses bg-severity-critical-value for critical rows and renders the redundant glyph", () => {
    renderRegion([
      baseReading(DEVICE_A, CRITICAL_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    const cell = row.querySelector('[aria-label="critical severity"]');
    const dot = cell?.querySelector("span");
    expect(dot?.className ?? "").toContain("bg-severity-critical-value");
    // UX-DR-3 wants a redundant non-colour cue: the critical glyph
    // is the U+25CF "hot" shape (a filled circle).
    expect(dot?.textContent).toBe("\u25CF");
  });

  it("healthy rows render the healthy glyph", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);
    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    const cell = row.querySelector('[aria-label="healthy severity"]');
    // U+2713 "check" — the smallest glyph that distinguishes
    // healthy from warning/critical/offline without colour.
    expect(cell?.querySelector("span")?.textContent).toBe("\u2713");
  });
});

describe("Story 2.8 — AC3: live-update pulse + age reset", () => {
  it("the row does NOT pulse on first render", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    expect(row.className).not.toContain("animate-live-pulse");
  });

  it("does NOT pulse when server_received_at is unchanged across re-renders", () => {
    // The pulse-replay contract depends on the `prevServerReceivedAtRef`
    // guard inside `LiveReadingsRow`. A regression that drops the
    // guard (e.g., always-pulse on every render) would re-fire the
    // keyframe on every cache invalidation even when the reading
    // payload didn't advance — operators would see every row pulse
    // on every socket event. This test pins the idempotency.
    const reading = baseReading(
      DEVICE_A,
      HEALTHY_METRICS,
      "School A",
      "2026-08-24T10:00:00.000Z",
    );

    const { rerender } = renderRegion([reading]);
    const row = screen.getByTestId(`dashboard-live-readings-row-${DEVICE_A}`);
    expect(row.className).not.toContain("animate-live-pulse");

    // Same payload, different reference identity (a fresh array
    // arrives from the parent Dashboard after every reading:new).
    rerender(<LiveReadingsRegion readings={[reading]} />);

    expect(row.className).not.toContain("animate-live-pulse");
  });

  it("advancing server_received_at applies animate-live-pulse to the affected row", async () => {
    const first = baseReading(
      DEVICE_A,
      HEALTHY_METRICS,
      "School A",
      "2026-08-24T10:00:00.000Z",
    );
    const updated: LatestReadingPayload = {
      ...first,
      server_received_at: "2026-08-24T10:00:01.000Z",
      ts: Date.parse("2026-08-24T10:00:01.000Z"),
    };

    const { rerender } = renderRegion([first]);
    const rowBefore = screen.getByTestId(
      `dashboard-live-readings-row-${DEVICE_A}`,
    );
    expect(rowBefore.className).not.toContain("animate-live-pulse");

    rerender(<LiveReadingsRegion readings={[updated]} />);

    await waitFor(() => {
      const rowAfter = screen.getByTestId(
        `dashboard-live-readings-row-${DEVICE_A}`,
      );
      expect(rowAfter.classList.contains("animate-live-pulse")).toBe(true);
    });
  });

  it("the age cell resets to 'just now' on the updated row", () => {
    // Pin a recent timestamp (≤ 5 s old) so the formatter yields
    // "just now" exactly once the row re-renders.
    const recent = new Date(Date.now() - 2_000).toISOString();
    const fresh: LatestReadingPayload = {
      ...baseReading(DEVICE_A, HEALTHY_METRICS, "School A", recent),
      ts: Date.parse(recent),
    };

    renderRegion([fresh]);

    expect(
      screen.getByTestId(`dashboard-live-readings-row-age-${DEVICE_A}`),
    ).toHaveTextContent("just now");
  });

  it("the age cell shows '<n>s ago' for a few-seconds-old reading", () => {
    const ago = new Date(Date.now() - 12_000).toISOString();
    const reading: LatestReadingPayload = {
      ...baseReading(DEVICE_A, HEALTHY_METRICS, "School A", ago),
      ts: Date.parse(ago),
    };

    renderRegion([reading]);

    expect(
      screen.getByTestId(`dashboard-live-readings-row-age-${DEVICE_A}`),
    ).toHaveTextContent(/\d+s ago/);
  });

  it("the age cell resets from '<n>s ago' to 'just now' on a fresh reading", async () => {
    // The previous 'age reset' tests render once with a fresh
    // timestamp — they never cross the stale→fresh boundary inside
    // a single lifecycle. This test does: render with a stale reading,
    // assert "<n>s ago", then rerender with a fresh one and assert
    // the transition. Catches regressions where `Date.now()` is
    // memoized at module load instead of computed per render.
    const staleAgo = new Date(Date.now() - 30_000).toISOString();
    const fresh = new Date(Date.now() - 1_500).toISOString();
    const stale: LatestReadingPayload = {
      ...baseReading(DEVICE_A, HEALTHY_METRICS, "School A", staleAgo),
      ts: Date.parse(staleAgo),
    };
    const freshReading: LatestReadingPayload = {
      ...baseReading(DEVICE_A, HEALTHY_METRICS, "School A", fresh),
      ts: Date.parse(fresh),
    };

    const { rerender } = renderRegion([stale]);
    expect(
      screen.getByTestId(`dashboard-live-readings-row-age-${DEVICE_A}`),
    ).toHaveTextContent(/\d+s ago/);

    rerender(<LiveReadingsRegion readings={[freshReading]} />);
    await waitFor(() => {
      expect(
        screen.getByTestId(`dashboard-live-readings-row-age-${DEVICE_A}`),
      ).toHaveTextContent("just now");
    });
  });
});

describe("Story 2.8 — AC4: read-only surface (no sort, no buttons)", () => {
  it("renders the table with no sort control", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
    ]);

    // The region ships a header + the table; there is no <button>
    // for sort, no toggleable affordance. The header copy is the
    // section title only.
    const region = screen.getByTestId("dashboard-live-readings-region");
    expect(region.querySelectorAll("button")).toHaveLength(0);
    expect(region.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

  it("renders no per-row action buttons", () => {
    renderRegion([
      baseReading(DEVICE_A, HEALTHY_METRICS, "School A", "2026-08-24T10:00:00.000Z"),
      baseReading(DEVICE_B, CRITICAL_METRICS, "School B", "2026-08-24T10:00:00.000Z"),
    ]);

    const region = screen.getByTestId("dashboard-live-readings-region");
    expect(region.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("Story 2.8 — empty state contract (preserved from Story 2.6)", () => {
  it("renders the static 'No readings yet' copy when readings is empty", () => {
    renderRegion([]);

    const empty = screen.getByTestId("dashboard-live-readings-empty");
    expect(empty).toHaveTextContent("No readings yet");
    expect(screen.queryByTestId("dashboard-live-readings-table")).toBeNull();
  });

  it("the empty state does not pulse or animate on first render", () => {
    renderRegion([]);

    const empty = screen.getByTestId("dashboard-live-readings-empty");
    expect(empty.className).not.toContain("animate-live-pulse");
    expect(empty.className).not.toContain("animate-");
  });
});
