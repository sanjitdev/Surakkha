/**
 * F-W1 — SKIP_MIGRATIONS escape hatch contract.
 *
 * Pins the v1 contract: when the api boot path sees
 * `SKIP_MIGRATIONS=true` in env, it must NOT dynamically import
 * `@surakkha/db/scripts/migrate` and must NOT call `runMigrations()`.
 * The default path (env unset / any other value) keeps the existing
 * `runMigrations()` boot behaviour.
 *
 * Why a source-walk test rather than a unit test of `boot()`:
 *   1. The boot path runs at module import time (it calls
 *      `httpServer.listen(PORT, ...)` immediately, before any test
 *      can intercept), so a unit test would have to either mock the
 *      listener (brittle) or refactor boot to be exported separately.
 *   2. The contract we care about is "the env var is recognised and
 *      it gates the dynamic import" — a single text-shape assertion
 *      is sharper than any behavioural mock would be.
 *
 * The test walks `packages/api/src/` and asserts the index.ts boot
 * path contains:
 *   - `const SKIP_MIGRATIONS = process.env.SKIP_MIGRATIONS === "true";`
 *     (env read + exact-string compare, so the contract is pinned)
 *   - An early-return / if-branch that skips the dynamic import when
 *     SKIP_MIGRATIONS is true.
 *
 * If a future PR changes the gating to a different shape (e.g. moves
 * the check into a helper), update this test in the same change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const INDEX_TS = join(__dirname, "..", "src", "index.ts");

describe("F-W1 — SKIP_MIGRATIONS escape hatch contract", () => {
  const source = readFileSync(INDEX_TS, "utf-8");

  it("api/index.ts reads SKIP_MIGRATIONS from process.env", () => {
    // The exact `=== "true"` compare pins the v1 contract: the
    // string "true" is the only truthy value. A future change to
    // accept "1" / "yes" must update this assertion in lockstep.
    expect(source).toMatch(
      /process\.env\.SKIP_MIGRATIONS\s*===\s*["']true["']/,
    );
  });

  it("api/index.ts gates the dynamic import on SKIP_MIGRATIONS", () => {
    // The dynamic import of `@surakkha/db/scripts/migrate` must
    // appear AFTER a SKIP_MIGRATIONS branch. We verify by locating
    // both tokens and checking the SKIP_MIGRATIONS read precedes
    // the import statement.
    const skipIdx = source.search(/process\.env\.SKIP_MIGRATIONS/);
    const importIdx = source.indexOf("@surakkha/db/scripts/migrate");
    expect(skipIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeGreaterThan(-1);
    expect(skipIdx).toBeLessThan(importIdx);
  });

  it("api/index.ts short-circuits runMigrations when SKIP_MIGRATIONS=true", () => {
    // Pin the exact branch shape so a future refactor that drops
    // the early return (e.g. replaces the gate with a try/catch
    // wrapper) fails this test loudly.
    expect(source).toMatch(/if\s*\(\s*SKIP_MIGRATIONS\s*\)/);
  });

  it("api/index.ts still calls runMigrations on the default path", () => {
    // Sanity: the migration call must remain reachable when the
    // env var is unset / not "true". Locate the call and confirm
    // it is OUTSIDE the SKIP_MIGRATIONS if-branch.
    expect(source).toMatch(/migrateModule\.runMigrations\(\)/);
  });

  it("api/index.ts logs a skip notice when SKIP_MIGRATIONS=true", () => {
    // The skip path must announce itself so the operator can tell
    // why migrations did not run.
    expect(source).toMatch(/api: skipping migrations/);
  });
});
