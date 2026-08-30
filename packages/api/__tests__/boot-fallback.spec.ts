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
 * After the 2026-08-30 distillation, the rule-engine initialization
 * lives in `packages/api/src/boot/ruleEngine.ts` (extracted from
 * `index.ts` to keep `index.ts` under `max-lines: 500`). The
 * `index.ts` callsite (`await initializeRuleEngine()`) remains,
 * so we walk BOTH files in this test:
 *
 *   - `src/boot/ruleEngine.ts` holds the try/catch, the
 *     `console.error` prefix, and the `setIngestHooks(NOOP_HOOKS)`
 *     fallback (the contract-shaped code).
 *   - `src/index.ts` holds the callsite (`await
 *     initializeRuleEngine()`) so the boot path actually invokes
 *     the contract.
 *
 * Update this test when relocating the contract to a different
 * file — the assertions are anchored to literal text, not to the
 * module identity.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RULE_ENGINE_TS = join(__dirname, "..", "src", "boot", "ruleEngine.ts");
const INDEX_TS = join(__dirname, "..", "src", "index.ts");

describe("Story 3.2 — boot-fallback to no-op hooks on hydrate failure", () => {
  it("api/boot/ruleEngine.ts hydrates the cache, falls back to NOOP_HOOKS on failure, logs the documented error", () => {
    const source = readFileSync(RULE_ENGINE_TS, "utf-8");

    // 1. The hydration runs inside the boot() chain (so the cache
    //    is populated before the first WS connection). The exported
    //    function MUST be named `initializeRuleEngine` so the
    //    callsite in `index.ts` matches the original contract.
    expect(source).toMatch(/export\s+const\s+initializeRuleEngine\s*=/);

    // 2. The try/catch wraps `hydrateActiveRuleCache`.
    expect(source).toMatch(/try\s*\{[\s\S]*?hydrateActiveRuleCache[\s\S]*?\}\s*catch/);

    // 3. The catch branch logs via `console.error` with the
    //    documented message prefix.
    expect(source).toMatch(/console\.error\(\s*["']\[rules\]\s+boot:\s+hydrate failed/);

    // 4. The catch branch installs `NOOP_HOOKS` so the api keeps
    //    serving without rule evaluation. Pin both the import and
    //    the call site. The path regex accepts an optional `.js`
    //    suffix (TypeScript ESM convention).
    expect(source).toMatch(
      /import\s*\{[^}]*\bNOOP_HOOKS\b[^}]*\}\s*from\s*["']\.\.\/ingest\/hooks(?:\.js)?["']/,
    );
    expect(source).toMatch(/setIngestHooks\s*\(\s*NOOP_HOOKS\s*\)/);
  });

  it("api/index.ts calls initializeRuleEngine inside boot()", () => {
    // The contract-shaped code lives in boot/ruleEngine.ts; the
    // boot() orchestration in index.ts MUST invoke it (otherwise
    // the boot path skips rule hydration entirely).
    const source = readFileSync(INDEX_TS, "utf-8");
    expect(source).toMatch(/initializeRuleEngine\s*\(\s*\)/);
  });
});
