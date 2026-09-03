/**
 * vitest config — Surakkha web.
 *
 * Defaults to happy-dom so React Testing Library can render components.
 * Tests for tokens (Story 1.2a) work in either environment; the shell
 * tests (Story 1.2b) need a DOM. `@testing-library/jest-dom` is loaded
 * once at startup so `toBeInTheDocument()` is available everywhere.
 *
 * The Playwright e2e specs under `./e2e/` are EXCLUDED here — they
 * import `test` from `@playwright/test`, not vitest, so discovering
 * them with vitest errors out at the first `test.describe()` call.
 * Run e2e with `pnpm test:e2e` (Playwright's own runner) instead.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    // vitest's defaults already exclude `node_modules`, `dist`, etc.
    // We add `e2e/` so the Playwright specs stay out of this run.
    exclude: ["node_modules", "dist", ".idea", ".git", ".cache", "e2e"],
  },
});
