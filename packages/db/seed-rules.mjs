/* eslint-env node */
// Quick dev seed — creates the FR-13 default Rules so the api's
// rule engine evaluates incoming readings and emits Alerts.
//
// `hysteresisSeconds` MUST be non-zero for every rule: the api's
// boot-time write-amplification guard (`rules/hooks.ts`) refuses to
// install hooks when ANY active rule has `minDurationSeconds === 0
// AND hysteresisSeconds === 0`. The guard exists so a misconfigured
// rule (e.g. a forgotten-hysteresis oversight) cannot drive an
// unbounded Alert write rate at every reading tick.
//
// Instant rules still get `minDurationSeconds: 0` (the rule fires
// on the first breaching frame — no debounce window). The hysteresis
// is a small non-zero default so the guard is satisfied; the value
// matches the api's recommended default for instant rules
// (architecture §7.2 — 30-second recovery window).
import { PrismaClient } from "@prisma/client";

const c = new PrismaClient();

const HYSTERESIS_SECONDS = 30;

const rules = [
  {
    metric: "ph",
    operator: "lt",
    threshold: 6.5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "ph",
    operator: "gt",
    threshold: 8.5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "tds_ppm",
    operator: "gte",
    threshold: 300,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "tds_ppm",
    operator: "gte",
    threshold: 1000,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "turbidity_ntu",
    operator: "gt",
    threshold: 5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "chlorine_ppm",
    operator: "lt",
    threshold: 0.2,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "chlorine_ppm",
    operator: "gt",
    threshold: 1.5,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "temp_c",
    operator: "gt",
    threshold: 45,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
  {
    metric: "water_level_cm",
    operator: "lt",
    threshold: 20,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: HYSTERESIS_SECONDS,
  },
];

let seeded = 0;
for (const r of rules) {
  // Idempotent: upsert by the schema's compound unique key
  // `[deviceId, metric, operator, threshold, version]`
  // (`packages/db/prisma/schema.prisma:560`). The api's boot-time
  // write-amplification guard
  // (`packages/api/src/rules/hooks.ts:280`) refuses to install
  // hooks when ANY active rule has `minDurationSeconds === 0 AND
  // hysteresisSeconds === 0`. Re-running this seed on an existing
  // db must therefore UPDATE the hysteresis on pre-existing rows
  // — a plain `create` would error on the unique constraint and
  // leave the old (broken) hysteresis in place.
  await c.rule.upsert({
    where: {
      deviceId_metric_operator_threshold_version: {
        deviceId: null,
        metric: r.metric,
        operator: r.operator,
        threshold: r.threshold,
        version: 1,
      },
    },
    create: {
      deviceId: null,
      metric: r.metric,
      operator: r.operator,
      threshold: r.threshold,
      severity: r.severity,
      ruleType: r.ruleType,
      minDurationSeconds: r.minDurationSeconds,
      hysteresisSeconds: r.hysteresisSeconds,
      version: 1,
      createdBy: null,
      isActive: true,
    },
    update: {
      minDurationSeconds: r.minDurationSeconds,
      hysteresisSeconds: r.hysteresisSeconds,
      isActive: true,
    },
  });
  seeded++;
}
globalThis.console.log("seeded", seeded, "rules");
await c.$disconnect();
