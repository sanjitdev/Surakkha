/**
 * Story 3.2 — boot-fallback source-walk contract.
 *
 * Pins the v1 contract: when the api boot path's `hydrateActiveRuleCache`
 * rejects (DB outage at boot), the code MUST:
 *   1. Log via `console.error` with a specific message prefix.
 *   2. Call `setIngestHooks(NOOP_HOOKS)` so the api continues
 *      serving without rule evaluation.
 *   3. NOT crash the boot path.
 *
 * Why a source-walk test (mirrors `boot.skipMigrations.spec.ts`):
 *   - The boot path runs at module import time — a behavioural test
 *     would require refactoring boot to be exported separately.
 *   - The contract we care about is "the env error path is shaped
 *     correctly" — a single text-shape assertion is sharper than
 *     any behavioural mock.
 *
 * Single test per spec: walk `packages/api/src/index.ts` and assert
 * the try/catch + log + NOOP_HOOKS fallback all exist together.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const INDEX_TS = join(__dirname, "..", "src", "index.ts");

describe("Story 3.2 — boot-fallback to no-op hooks on hydrate failure", () => {
  it("api/index.ts hydrates the cache, falls back to NOOP_HOOKS on failure, logs the documented error", () => {
    const source = readFileSync(INDEX_TS, "utf-8");

    // 1. The hydration runs inside the boot() chain (so the cache
    //    is populated before the first WS connection).
    expect(source).toMatch(/initializeRuleEngine\s*\(\s*\)/);

    // 2. The try/catch wraps `hydrateActiveRuleCache`.
    expect(source).toMatch(/try\s*\{[\s\S]*?hydrateActiveRuleCache[\s\S]*?\}\s*catch/);

    // 3. The catch branch logs via `console.error` with the
    //    documented message prefix.
    expect(source).toMatch(
      /console\.error\(\s*["']\[rules\]\s+boot:\s+hydrate failed/,
    );

    // 4. The catch branch installs `NOOP_HOOKS` so the api keeps
    //    serving without rule evaluation. Pin both the import and
    //    the call site.
    expect(source).toMatch(
      /import\s*\{[^}]*\bNOOP_HOOKS\b[^}]*\}\s*from\s*["']\.\/ingest\/hooks["']/,
    );
    expect(source).toMatch(/setIngestHooks\s*\(\s*NOOP_HOOKS\s*\)/);
  });
});
