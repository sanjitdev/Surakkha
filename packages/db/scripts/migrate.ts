/**
 * Story 2.2 — Prisma migrate wrapper.
 *
 * Runs `prisma generate` (so the api can `@prisma/client`) followed by
 * `prisma migrate deploy` (so the schema is applied to the running
 * Postgres instance before the api starts accepting frames).
 *
 * Invoked from the api boot path. Failures throw — the boot path turns
 * the throw into `process.exit(1)` so Docker Compose restarts the
 * container until Postgres + schema are healthy.
 *
 * Reference: Story 2.2 Tasks & Acceptance §"packages/db/scripts/migrate.ts".
 */
import { execFileSync } from "node:child_process";

const run = (args: readonly string[]): void => {
  // execFileSync so shell injection isn't possible — args come from
  // the call site, but the rule is hard-coded here so a future caller
  // cannot interpolate user input.
  execFileSync("pnpm", ["exec", "prisma", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
};

export const runMigrations = (): void => {
  run(["generate"]);
  run(["migrate", "deploy"]);
};

// Allow `pnpm --filter @surakkha/db exec tsx scripts/migrate.ts` to run
// the migration as a one-shot CLI invocation.
if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  try {
    runMigrations();
  } catch (cause) {
    console.error("prisma migrate failed", cause);
    // eslint-disable-next-line no-restricted-properties
    process.exit(1);
  }
}