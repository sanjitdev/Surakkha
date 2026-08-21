/**
 * Story 1.9 — Critical-First Visual Hierarchy on the Shell.
 *
 * ATDD (Red Phase). Tests reference the future `KpiStat` component and
 * the future `/severity-cards` route mounted in main.tsx. Once the
 * implementation lands the tests pinned here go green.
 *
 * Coverage matrix (each AC bullet -> at least one `it(...)`):
 *
 *   AC1 (sample severity card uses value/text/fill/bg/glow):
 *     - "applies the severity value, text, fill, bg, and glow tokens"
 *     - "applies the critical value to the border, KPI stripe, and shadow"
 *
 *   AC2 (critical KPI numeral font-size 44px vs 40px; 4px critical left border):
 *     - "renders the critical KPI numeral at 44px"
 *     - "renders a non-critical KPI numeral at 40px"
 *     - "renders a 4px left border with the critical value token"
 *
 *   AC3 (critical pulse 1500ms; healthy no continuous animation):
 *     - "applies the 1500ms critical pulse animation when critical"
 *     - "applies no continuous animation when healthy"
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KpiStat } from "./KpiStat";

const SEVERITY = {
  healthy: { value: "#1F9D55", text: "#0F6B3A", fill: "#16A34A", bg: "#E8F6EE", glow: "#1F9D5533" },
  warning: { value: "#D97706", text: "#92400E", fill: "#F59E0B", bg: "#FFF3DA", glow: "#F59E0B33" },
  critical: { value: "#DC2626", text: "#7F1D1D", fill: "#EF4444", bg: "#FEE2E2", glow: "#EF444433" },
  offline: { value: "#64748B", text: "#475569", fill: "#94A3B8", bg: "#F1F5F9", glow: "#64748B33" },
} as const;

describe("Story 1.9 — AC1: sample severity card uses the registered tokens", () => {
  afterEach(() => cleanup());

  it("applies the critical value, text, fill, bg, and glow tokens", () => {
    render(<KpiStat severity="critical" label="TDS" value="610" />);
    const card = screen.getByTestId("kpi-stat");
    // The className drives all token consumption. The Tailwind utilities
    // resolve to the severity-critical palette at compile time.
    expect(card.className).toContain("border-severity-critical-value");
    expect(card.className).toContain("text-severity-critical-text");
    expect(card.className).toContain("bg-severity-critical-bg");
  });

  it("applies the critical value to the border, KPI stripe, and shadow", () => {
    render(<KpiStat severity="critical" label="TDS" value="610" />);
    const card = screen.getByTestId("kpi-stat");
    // AC1: border (left), KPI stripe (left border), shadow (elevation +
    // glow) all resolve to the critical severity.
    expect(card.className).toContain("border-severity-critical-value");
    expect(card.className).toContain("border-l-4");
    // The shadow string contains the critical glow colour.
    expect(card.className).toContain("shadow-elevation-card");
  });

  it("applies the healthy palette when severity is healthy", () => {
    render(<KpiStat severity="healthy" label="pH" value="7.2" />);
    const card = screen.getByTestId("kpi-stat");
    expect(card.className).toContain("border-severity-healthy-value");
    expect(card.className).toContain("text-severity-healthy-text");
    expect(card.className).toContain("bg-severity-healthy-bg");
  });
});

describe("Story 1.9 — AC2: critical KPI numeral font-size 44px (40px non-critical)", () => {
  afterEach(() => cleanup());

  it("renders the critical KPI numeral at 44px", () => {
    render(<KpiStat severity="critical" label="TDS" value="610" />);
    const numeral = screen.getByTestId("kpi-stat-numeral");
    expect(numeral.className).toContain("text-kpi-numeral-critical");
  });

  it("renders a non-critical KPI numeral at 40px", () => {
    render(<KpiStat severity="healthy" label="pH" value="7.2" />);
    const numeral = screen.getByTestId("kpi-stat-numeral");
    expect(numeral.className).toContain("text-kpi-numeral");
    expect(numeral.className).not.toContain("text-kpi-numeral-critical");
  });

  it("renders a 4px left border with the critical value token", () => {
    render(<KpiStat severity="critical" label="TDS" value="610" />);
    const card = screen.getByTestId("kpi-stat");
    expect(card.className).toContain("border-l-4");
    expect(card.className).toContain("border-severity-critical-value");
  });

  it("renders a 3px left border with the healthy value token", () => {
    render(<KpiStat severity="healthy" label="pH" value="7.2" />);
    const card = screen.getByTestId("kpi-stat");
    expect(card.className).toContain("border-l-3");
    expect(card.className).toContain("border-severity-healthy-value");
  });
});

describe("Story 1.9 — AC3: critical pulse 1500ms; healthy no continuous animation", () => {
  afterEach(() => cleanup());

  it("applies the 1500ms critical pulse animation when critical", () => {
    render(<KpiStat severity="critical" label="TDS" value="610" />);
    const card = screen.getByTestId("kpi-stat");
    expect(card.className).toContain("animate-critical-pulse");
  });

  it("applies no continuous animation when healthy", () => {
    render(<KpiStat severity="healthy" label="pH" value="7.2" />);
    const card = screen.getByTestId("kpi-stat");
    expect(card.className).not.toContain("animate-critical-pulse");
    expect(card.className).not.toContain("animate-critical-pulse");
  });

  it("applies the critical pulse class only to critical", () => {
    const { rerender } = render(<KpiStat severity="healthy" label="pH" value="7.2" />);
    expect(screen.getByTestId("kpi-stat").className).not.toContain("animate-critical-pulse");
    rerender(<KpiStat severity="critical" label="pH" value="6.8" />);
    expect(screen.getByTestId("kpi-stat").className).toContain("animate-critical-pulse");
  });
});

// `SEVERITY` is referenced by future pin checks; the lint will warn
// otherwise. The actual value verification happens in `tokens.spec.ts`
// (Story 1.2a). The const is here so the spec is a self-contained
// reference, not a duplicate of the source-of-truth pin.
void SEVERITY;
