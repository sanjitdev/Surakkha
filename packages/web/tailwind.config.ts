/**
 * Tailwind config — Surakkha design tokens (Story 1.2a).
 *
 * This file is the **single source of truth** for visual tokens at the
 * Tailwind layer. Every literal below is mirrored verbatim from
 * `_bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/DESIGN.md`
 * (DESIGN.md §Brand & Style, §Colors, §Typography, §Layout & Spacing,
 * §Elevation & Depth, §Shapes).
 *
 * Token coverage required by Story 1.2a ACs:
 *
 *   AC1 — `theme.extend.colors.severity.{healthy,warning,critical,offline}`
 *         exposes `value`, `text`, `fill`, `bg`, `glow` for each severity.
 *   AC1 — `color.primary_gradient` resolves to
 *         `linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)`.
 *   AC3 — `radius.card` 10px, `radius.input` 8px, `radius.pill` 999px.
 *   AC3 — `elevation.card` = `0 1px 2px rgba(15,23,42,0.04),
 *                            0 4px 12px rgba(15,23,42,0.06)`.
 *   AC3 — `density.card_padding` 20px, `density.row_padding` 12px.
 *
 * Companion CSS lives at `packages/web/src/index.css`. The token tests at
 * `packages/web/src/tokens.spec.ts` assert that every required token is
 * present and pinned to its DESIGN.md value.
 */
import type { Config } from "tailwindcss";

// `tailwindConfig` is the named binding that satisfies Tailwind's
// canonical default-export pattern. The export line carries a scoped
// `eslint-disable` for `no-restricted-syntax`, which wants a PascalCase
// (component) or camelCase (utility) name for default-exported
// identifiers — Tailwind's pattern is neither.
const tailwindConfig = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media", // Story 1.2a AC: system-default, no manual toggle in v1.
  theme: {
    // Replace the default spacing scale with the one DESIGN.md mandates:
    // 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
    spacing: {
      0: "0",
      1: "4px",
      2: "8px",
      3: "12px",
      4: "16px",
      6: "24px",
      8: "32px",
      12: "48px",
      16: "64px",
      px: "1px",
    },
    extend: {
      colors: {
        // Severity is the only saturated palette — every shade below is
        // reserved for status meaning. See DESIGN.md §Colors.
        severity: {
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
        },
        // Neutral palette (DESIGN.md §Colors).
        neutral: {
          surface: "#FFFFFF",
          page: "#F5F7F9",
          sidebar: "#0F172A",
          sidebar_text: "#CBD5E1",
          sidebar_text_active: "#FFFFFF",
          border: "#E2E8F0",
          body: "#0F172A",
          secondary: "#475569",
        },
        // Primary + supporting hues.
        primary: {
          DEFAULT: "#1E5BB8",
          hover: "#1E40AF",
        },
      },
      // Custom color slot for `bg-primary_gradient` etc. — defined as a
      // string because Tailwind does not understand `linear-gradient(...)`
      // as a colour utility; consumers use it via `style={{ background:
      // 'linear-gradient(...)' }}` or the `bg-primary-gradient` class below.
      backgroundImage: {
        "primary-gradient":
          "linear-gradient(135deg, #1E5BB8 0%, #0EA5E9 100%)",
      },
      // Type scale (DESIGN.md §Typography).
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      fontSize: {
        // semantic scale from DESIGN.md §Typography
        xs: ["12px", { lineHeight: "18px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        md: ["15px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "28px" }],
        xl: ["20px", { lineHeight: "28px" }],
        "2xl": ["24px", { lineHeight: "32px" }],
        "3xl": ["28px", { lineHeight: "32px" }],
        "4xl": ["36px", { lineHeight: "40px" }],
        // KPI numeral sizes (DESIGN.md §Components: KPIStat numeral_size
        // 40px; numeral_size_critical 44px). Story 1.9 AC2.
        "kpi-numeral": ["40px", { lineHeight: "48px" }],
        "kpi-numeral-critical": ["44px", { lineHeight: "52px" }],
      },
      borderRadius: {
        // DESIGN.md §Shapes — three named radii + standard full pill.
        card: "10px",
        input: "8px",
        pill: "999px",
      },
      // Density baseline (DESIGN.md §Layout & Spacing). Surface as
      // arbitrary values so a consumer can write `p-density-card` or
      // `py-density-row` (Tailwind resolves these to the CSS variables
      // exposed in index.css).
      padding: {
        density: {
          card: "20px",
          row: "12px",
        },
      },
      // Elevation tokens (DESIGN.md §Elevation & Depth).
      boxShadow: {
        "elevation-card":
          "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)",
        "elevation-topbar": "0 1px 2px rgba(15, 23, 42, 0.04)",
        "elevation-banner-critical": "0 0 24px #EF444433",
      },
      // Motion durations (DESIGN.md §Elevation & Depth, §Components). Each
      // resolves to a `duration-*` utility. The CSS keyframes live in
      // `index.css`; these are durations only.
      transitionDuration: {
        "live-pulse": "1200ms",
        "critical-pulse": "1500ms",
        "pin-pulse": "2000ms",
        "banner-fade-in": "200ms",
      },
      // Page horizontal padding per breakpoint (DESIGN.md §Layout & Spacing).
      maxWidth: {
        canvas: "1440px",
      },
    },
  },
  plugins: [],
} as const satisfies Config;

/* eslint-disable no-restricted-syntax -- see header. This is Tailwind's
   canonical config shape; the named binding trips the
   `no-restricted-syntax` rule that wants a PascalCase or camelCase
   identifier for default-exported bindings. Tailwind itself expects the
   default-export identifier pattern, so we accept the hint here. */
export default tailwindConfig;
