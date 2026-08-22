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
import { fileURLToPath } from "node:url";

/**
 * F-P15: anchor the `prisma` invocation's cwd to the db package
 * directory, NOT the caller's cwd. The api boot path calls this via
 * dynamic import after the api has potentially changed directories;
 * `process.cwd()` would mis-resolve `schema.prisma`. We resolve
 * relative to `import.meta.url` so the cwd is correct regardless
 * of where the caller is.
 */
const DB_PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));

const run = (args: readonly string[]): void => {
  // execFileSync so shell injection isn't possible — args come from
  // the call site, but the rule is hard-coded here so a future caller
  // cannot interpolate user input.
  execFileSync("pnpm", ["exec", "prisma", ...args], {
    cwd: DB_PACKAGE_DIR,
    stdio: "inherit",
  });
};

export const runMigrations = (): void => {
  run(["generate"]);
  run(["migrate", "deploy"]);
};

/**
 * Allow `pnpm --filter @surakkha/db exec tsx scripts/migrate.ts` to
 * run the migration as a one-shot CLI invocation. F-P15: compare
 * via `fileURLToPath` (not raw `file://` string) because Windows
 * uses `file:///C:/...` while POSIX uses `file:///...`, and the
 * argv[1] form differs too.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(
    new URL(`file://${process.argv[1]}`),
  );
if (invokedDirectly) {
  try {
    runMigrations();
  } catch (cause) {
    console.error("prisma migrate failed", cause);
    // eslint-disable-next-line no-restricted-properties
    process.exit(1);
  }
}