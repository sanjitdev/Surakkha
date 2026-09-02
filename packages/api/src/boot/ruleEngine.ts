/**
 * Boot-time initialization of the rules engine: hydrate the
 * active-rule cache from Postgres, then install the rule-engine
 * hooks on the ingest pipeline.
 *
 * Boot-fallback contract: a transient DB outage at boot does NOT
 * crash the api process — the catch installs `NOOP_HOOKS` so the
 * api keeps serving HTTP + WS without rule evaluation. A
 * `WriteAmplificationError` (boot guard config error) is
 * re-thrown so the outer `boot()` catch exits with `EX_CONFIG` (78).
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
    if (err instanceof WriteAmplificationError) throw err;
    console.error("[rules] boot: hydrate failed; running with no-op hooks", err);
    setIngestHooks(NOOP_HOOKS);
  }
};
