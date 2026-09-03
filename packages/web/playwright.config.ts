import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the web package's black-box regression suite.
 *
 * Scope: the three SPA fixes shipped in 56c1a49 + 57bf5eb (nginx
 * trailing-slash, RequireAuth gate, ProtectedShell shared layout). Tests
 * hit the running nginx-fronted stack at `baseURL`.
 *
 * Assumes the stack is already up. `webServer: docker compose up` is
 * intentionally NOT configured here — the dev loop is "compose up,
 * then `pnpm -F web test:e2e`", and Playwright's webServer healthcheck
 * blocks for 60s while the stack takes ~90s on a cold cache. Wiring CI
 * to bring up its own stack belongs in `.github/workflows/ci.yml`.
 *
 * Viewport is pinned to 1440x900 so the test always lands on
 * `[data-testid="sidebar-fixed"]` (≥1024px breakpoint in
 * `packages/web/src/shell/Sidebar.tsx`). The drawer variant
 * (`sidebar-drawer`) at <1024px is out of scope for these specs.
 *
 * Reporter and artifact retention are CI-aware: green runs leave no
 * clutter; failures keep the trace/screenshot/video for triage.
 */
export default defineConfig({
  testDir: "./e2e",
  // The SPA fixture is shared by all 3 specs but they exercise disjoint
  // paths, so parallel execution is safe.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
