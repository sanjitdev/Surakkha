/**
 * Story 3.2 — ReadingRepository.findMany source-walk contract.
 *
 * Pins the v1 contract: the `ReadingRepository` interface in
 * `packages/api/src/ingest/frame.ts` MUST expose a `findMany` slice
 * method with the documented `where` / `orderBy` / `take` shape
 * that the rules-engine rate/absence pre-filter chain uses.
 *
 * The hook's `installRuleEngineHooks(...)` calls
 * `readingRepository.reading.findMany({ where: { deviceId, metric,
 * ts: { gte } }, orderBy: { ts: "asc" }, take: ... })`. A
 * regression that drops any of these args (e.g. switches the
 * `orderBy` to `"desc"`, removes `take`, or drops the `ts.gte`
 * filter) silently breaks the rate-rule regression without a
 * compile-time error.
 *
 * Why a source-walk test (mirrors `auth.no-rotation.spec.ts`):
 *   - The interface extension is the seam; the only way to pin
 *     the contract is at the source level.
 *   - Future PRs that re-shape `findMany` fail this test on the
 *     file itself rather than at first integration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FRAME_TS = join(__dirname, "..", "src", "ingest", "frame.ts");

describe("Story 3.2 — ReadingRepository.findMany extension", () => {
  const source = readFileSync(FRAME_TS, "utf-8");

  it("ReadingRepository declares reading.findMany with the documented where/orderBy/take shape", () => {
    // 1. The slice method exists on `reading` (mirrors the `create`
    //    method already there).
    expect(source).toMatch(/readonly reading:\s*\{[\s\S]*?findMany\s*\(/);

    // 2. The `where` clause carries `deviceId`, `metric`, AND
    //    `ts: { gte: Date }`. All three are load-bearing — the
    //    hook's window query depends on the device filter, the
    //    metric filter, and the lower-bound on `ts`.
    expect(source).toMatch(/deviceId:\s*string/);
    expect(source).toMatch(/metric:\s*RuleMetric/);
    expect(source).toMatch(/ts:\s*\{\s*readonly gte:\s*Date\s*\}/);

    // 3. The `orderBy` is `{ ts: "asc" }` — defence-in-depth against
    //    a refactor that flips it to `"desc"`. The slope regression
    //    assumes ASC ordering.
    expect(source).toMatch(/orderBy:\s*\{\s*readonly ts:\s*["']asc["']\s*\}/);

    // 4. The `take` is a `number`. The exact constant is a hook
    //    implementation detail; the type pin is what matters.
    expect(source).toMatch(/readonly take:\s*number/);

    // 5. The return shape carries `ts: Date` AND `metrics:
    //    TelemetryFrame["metrics"]` (so the hook can extract the
    //    per-metric value).
    expect(source).toMatch(/readonly ts:\s*Date/);
    expect(source).toMatch(/readonly metrics:\s*TelemetryFrame\s*\[\s*["']metrics["']\s*\]/);
  });
});
