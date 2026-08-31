/**
 * `boot/ruleEngine.ts` — distilled 2026-08-30 (was inline in
 * `src/index.ts:718-743`).
 *
 * Boot-time initialization of the rules engine:
 *   1. Hydrate the active-rule cache from Postgres.
 *   2. Install the rule-engine hooks on the ingest pipeline.
 *
 * Story 3.2 — boot-fallback contract:
 *   The hydration runs inside a try/catch so a transient DB
 *   outage at boot does NOT crash the api process. On failure:
 *     - log via `console.error` with the documented prefix
 *       `[rules] boot: hydrate failed`.
 *     - install `NOOP_HOOKS` via `setIngestHooks` so the api
 *       keeps serving HTTP + WS requests, without rule
 *       evaluation.
 *
 * Story 3.4 — boot guard:
 *   A `WriteAmplificationError` thrown by the boot guard is a
 *   CONFIGURATION error (the rule cache contains a misconfigured
 *   rule that would melt the database). It is re-thrown so the
 *   outer `boot()` catch can exit with `EX_CONFIG` (78).
 *   Pinned by `boot-fallback.spec.ts`.
 *
 * Source-walk pin: the contract shape (`initializeRuleEngine(...)`,
 * try/catch around `hydrateActiveRuleCache`, `console.error` prefix,
 * `NOOP_HOOKS` import from `./ingest/hooks`, `setIngestHooks(NOOP_HOOKS)`)
 * is walked by `packages/api/__tests__/boot-fallback.spec.ts`.
 *   - BEFORE distillation: that test walked `src/index.ts`.
 *   - AFTER distillation: it walks this file. Update the test's
 *     `INDEX_TS` constant in the same PR that introduces this file.
 */
import { NOOP_HOOKS, setIngestHooks } from "../ingest/hooks.js";
import { hydrateActiveRuleCache } from "../rules/cache.js";
import { resolvePrismaAlertReader } from "../rules/findOpenAlert.js";
import {
  installRuleEngineHooks,
  resolveAlertStateRepository,
  WriteAmplificationError,
} from "../rules/hooks.js";
import { resolvePrismaRuleReader } from "../rules/prismaReader.js";

import { getPrisma } from "./db.js";
import { resolveReadingDelegate } from "./readingDelegate.js";

export const initializeRuleEngine = async (): Promise<void> => {
  const client = await getPrisma();
  try {
    const readingDelegate = await resolveReadingDelegate();
    const cache = await hydrateActiveRuleCache(resolvePrismaRuleReader(client));
    setIngestHooks(
      installRuleEngineHooks({
        cache,
        prisma: resolvePrismaRuleReader(client),
        readingRepository: readingDelegate,
        alertReader: resolvePrismaAlertReader(client),
        alertState: resolveAlertStateRepository(client),
      }),
    );
  } catch (err) {
    if (err instanceof WriteAmplificationError) {
      // Story 3.4 AC12 — configuration error, not a transient
      // outage. The boot guard already logged the offending
      // ruleId via `console.warn`; here we re-throw so the outer
      // `boot()` catch exits with EX_CONFIG. NOT swallowed.
      throw err;
    }
    console.error("[rules] boot: hydrate failed; running with no-op hooks", err);
    setIngestHooks(NOOP_HOOKS);
  }
};
