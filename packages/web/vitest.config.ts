/**
 * vitest config — Surakkha web.
 *
 * Defaults to happy-dom so React Testing Library can render components.
 * Tests for tokens (Story 1.2a) work in either environment; the shell
 * tests (Story 1.2b) need a DOM. `@testing-library/jest-dom` is loaded
 * once at startup so `toBeInTheDocument()` is available everywhere.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
  },
});
