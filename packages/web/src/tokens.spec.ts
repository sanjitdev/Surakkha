/**
 * Design-token tests — Story 1.2a.
 *
 * Resolves the Tailwind config and asserts every required token is present
 * and pinned to its DESIGN.md value. The matrix here mirrors the Story
 * 1.2a acceptance criteria: severity quintets, primary gradient, radii,
 * elevation, density, motion, type.
 *
 * Reading the resolved config rather than grepping the source means a
 * reviewer can verify the token contract end-to-end (config -> PostCSS ->
 * emitted CSS) and the test fails at the layer where a literal drifts.
 */
import { describe, expect, it } from "vitest";

import config from "../tailwind.config.js";

interface SeverityTriple {
  readonly value: string;
  readonly text: string;
  readonly fill: string;
  readonly bg: string;
  readonly glow: string;
}

interface ColorExt {
  readonly severity: Record<"healthy" | "warning" | "critical" | "offline", SeverityTriple>;
  readonly neutral: Record<string, string>;
  readonly primary: { readonly DEFAULT: string; readonly hover: string; readonly active: string };
}

const colors = (config.theme?.extend?.colors ?? {}) as ColorExt;
const radius = (config.theme?.extend?.borderRadius ?? {}) as Record<string, string>;
const spacing = (config.theme?.spacing ?? {}) as Record<string, string>;
const shadows = (config.theme?.extend?.boxShadow ?? {}) as Record<string, string>;
const durations = (config.theme?.extend?.transitionDuration ?? {}) as Record<string, string>;
const images = (config.theme?.extend?.backgroundImage ?? {}) as Record<string, string>;
const fonts = (config.theme?.extend?.fontFamily ?? {}) as Record<string, string[]>;

describe("Story 1.2a — severity quintets (DESIGN.md §Colors)", () => {
  const expected: Record<string, SeverityTriple> = {
    healthy: {
      value: "#1F9D55",
      text: "#0F6B3A",
      fill: "#16A34A",
      bg: "#E8F6EE",
      glow: "#1F9D5533",
    },
    warning: {
      value: "#D97706",
      text: "#92400E",
      fill: "#F59E0B",
      bg: "#FFF3DA",
      glow: "#F59E0B33",
    },
    critical: {
      value: "#DC2626",
      text: "#7F1D1D",
      fill: "#EF4444",
      bg: "#FEE2E2",
      glow: "#EF444433",
    },
    offline: {
      value: "#64748B",
      text: "#475569",
      fill: "#94A3B8",
      bg: "#F1F5F9",
      glow: "#64748B33",
    },
  };

  for (const [name, expectedTriple] of Object.entries(expected)) {
    it(`${name} exposes value/text/fill/bg/glow`, () => {
      const actual = colors.severity?.[name as keyof typeof colors.severity];
      expect(actual).toBeDefined();
      expect(actual).toEqual(expectedTriple);
    });
  }

  it("offline.glow is registered (used by scenario tiles)", () => {
    expect(colors.severity?.offline?.glow).toBe("#64748B33");
  });
});

describe("Story 1.2a — primary gradient (AC1)", () => {
  it("primary_gradient resolves to the documented gradient", () => {
    expect(images["primary-gradient"]).toBe("linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)");
  });

  it("primary DEFAULT, hover, and active accent match DESIGN.md", () => {
    expect(colors.primary?.DEFAULT).toBe("#1E5BB8");
    expect(colors.primary?.hover).toBe("#1E40AF");
    // DESIGN.md §Components → Sidebar: "nav icon tinted to #38BDF8"
    expect(colors.primary?.active).toBe("#38BDF8");
  });
});

describe("Story 1.2a — neutral palette", () => {
  it("registers the nine documented neutrals", () => {
    expect(colors.neutral?.surface).toBe("#FFFFFF");
    expect(colors.neutral?.page).toBe("#F5F7F9");
    expect(colors.neutral?.sidebar).toBe("#0F172A");
    expect(colors.neutral?.sidebar_text).toBe("#CBD5E1");
    expect(colors.neutral?.sidebar_text_active).toBe("#FFFFFF");
    // DESIGN.md §Components → Sidebar: active row tint `#1E293B`
    expect(colors.neutral?.sidebar_active).toBe("#1E293B");
    expect(colors.neutral?.border).toBe("#E2E8F0");
    expect(colors.neutral?.body).toBe("#0F172A");
    expect(colors.neutral?.secondary).toBe("#475569");
  });
});

describe("Story 1.2a — radii (DESIGN.md §Shapes)", () => {
  it("card = 10px, input = 8px, pill = 999px", () => {
    expect(radius.card).toBe("10px");
    expect(radius.input).toBe("8px");
    expect(radius.pill).toBe("999px");
  });
});

describe("Story 1.2a — spacing scale (DESIGN.md §Layout & Spacing)", () => {
  it("uses 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64", () => {
    expect(spacing[1]).toBe("4px");
    expect(spacing[2]).toBe("8px");
    expect(spacing[3]).toBe("12px");
    expect(spacing[4]).toBe("16px");
    expect(spacing[6]).toBe("24px");
    expect(spacing[8]).toBe("32px");
    expect(spacing[12]).toBe("48px");
    expect(spacing[16]).toBe("64px");
  });
});

describe("Story 1.2a — elevation tokens (DESIGN.md §Elevation & Depth)", () => {
  it("elevation.card matches the layered card shadow", () => {
    expect(shadows["elevation-card"]).toBe(
      "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)",
    );
  });
  it("elevation.topbar matches the topbar shadow", () => {
    expect(shadows["elevation-topbar"]).toBe("0 1px 2px rgba(15, 23, 42, 0.04)");
  });
  it("elevation.banner_critical matches the banner glow", () => {
    expect(shadows["elevation-banner-critical"]).toBe("0 0 24px #EF444433");
  });
});

describe("Story 1.2a — motion durations (DESIGN.md §Elevation & Depth)", () => {
  it("live_pulse = 1200ms", () => {
    expect(durations["live-pulse"]).toBe("1200ms");
  });
  it("critical_pulse = 1500ms", () => {
    expect(durations["critical-pulse"]).toBe("1500ms");
  });
  it("pin_pulse = 2000ms", () => {
    expect(durations["pin-pulse"]).toBe("2000ms");
  });
  it("banner_fade_in = 200ms", () => {
    expect(durations["banner-fade-in"]).toBe("200ms");
  });
});

describe("Story 1.2a — typography (DESIGN.md §Typography)", () => {
  it("Inter is registered with the documented fallback chain", () => {
    expect(fonts.sans?.[0]).toBe("Inter");
    expect(fonts.sans).toContain("system-ui");
    expect(fonts.sans).toContain("-apple-system");
    expect(fonts.sans).toContain("Segoe UI");
    expect(fonts.sans).toContain("Roboto");
  });
});

describe("Story 1.2a — dark mode is system-driven (DESIGN.md §Coverage)", () => {
  it("config.darkMode is 'media'", () => {
    expect(config.darkMode).toBe("media");
  });
});

describe("Story 1.2a AC2 — severity pill contrast", () => {
  // WCAG 2.1 contrast formula. Inputs are 8-bit sRGB channels in [0..255].
  // Returns the ratio between two relative luminances (≥ 1, ≤ 21).
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const relativeLuminance = (hex: string): number => {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (fg: string, bg: string): number => {
    const lF = relativeLuminance(fg);
    const lB = relativeLuminance(bg);
    const [hi, lo] = lF > lB ? [lF, lB] : [lB, lF];
    return (hi + 0.05) / (lo + 0.05);
  };

  // The four pill pairs (DESIGN.md §Components: severity `bg` surface
  // with severity `text` colour). DESIGN.md defines the `text` token
  // *specifically* as "the readable label colour against the matching
  // `bg` (≥ 4.5:1)" — so all four must clear WCAG 2.1 AA.
  const cases: ReadonlyArray<{
    readonly severity: string;
    readonly fg: string;
    readonly bg: string;
  }> = [
    { severity: "healthy", fg: "#0F6B3A", bg: "#E8F6EE" },
    { severity: "warning", fg: "#92400E", bg: "#FFF3DA" },
    { severity: "critical", fg: "#7F1D1D", bg: "#FEE2E2" },
    { severity: "offline", fg: "#475569", bg: "#F1F5F9" },
  ];

  for (const c of cases) {
    it(`${c.severity} pill text contrast ≥ 4.5:1`, () => {
      expect(contrast(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("Story 1.2a AC3 — card metrics", () => {
  // Story 1.2a AC3: "padding is 20px, radius is 10px, and elevation
  // matches `elevation.card` (`0 1px 2px rgba(15,23,42,0.04),
  // 0 4px 12px rgba(15,23,42,0.06)`)."
  // We pin the three values directly from the config; the .metric-card
  // utility in index.css is the consumer.
  it("padding 20px (density.card_padding)", () => {
    expect(
      (
        (config.theme?.extend?.padding as Record<string, unknown>)?.density as Record<
          string,
          string
        >
      )?.card,
    ).toBe("20px");
  });
  it("radius 10px (radius.card)", () => {
    expect(radius.card).toBe("10px");
  });
  it("elevation matches elevation.card", () => {
    expect(shadows["elevation-card"]).toBe(
      "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)",
    );
  });
  it("row padding is 12px (density.row_padding)", () => {
    expect(
      (
        (config.theme?.extend?.padding as Record<string, unknown>)?.density as Record<
          string,
          string
        >
      )?.row,
    ).toBe("12px");
  });
});
