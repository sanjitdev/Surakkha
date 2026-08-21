import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        // The shared package is type/logic only — coverage is incidental.
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
