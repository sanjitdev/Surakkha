import { defineConfig } from "vitest/config";

/**
 * Vitest config — packages/db (Story 2.5).
 *
 * Includes `prisma/*.spec.ts` (the seed's pure helpers) and
 * `__tests__/*.spec.ts` (Story 3.1 source-walk pins for the Rule
 * table). Excludes the seed script itself (`prisma/seed.ts`) — it
 * boots Prisma and calls `process.exit` at module load, which can't
 * run under vitest.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "prisma/**/*.{test,spec}.ts",
      "__tests__/**/*.{test,spec}.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        // The db package holds the seed script + helpers; coverage is
        // incidental. The pure helpers are 100% covered by
        // `seed.spec.ts`.
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});