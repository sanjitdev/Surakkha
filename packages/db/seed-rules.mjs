/* eslint-env node */
// Quick dev seed — creates the FR-13 default Rules so the api's
// rule engine evaluates incoming readings and emits Alerts.
import { PrismaClient } from "@prisma/client";

const c = new PrismaClient();

const rules = [
  {
    metric: "ph",
    operator: "lt",
    threshold: 6.5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "ph",
    operator: "gt",
    threshold: 8.5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "tds_ppm",
    operator: "gte",
    threshold: 300,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "tds_ppm",
    operator: "gte",
    threshold: 1000,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "turbidity_ntu",
    operator: "gt",
    threshold: 5,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "chlorine_ppm",
    operator: "lt",
    threshold: 0.2,
    severity: "critical",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "chlorine_ppm",
    operator: "gt",
    threshold: 1.5,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "temp_c",
    operator: "gt",
    threshold: 45,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
  {
    metric: "water_level_cm",
    operator: "lt",
    threshold: 20,
    severity: "warning",
    ruleType: "instant",
    minDurationSeconds: 0,
    hysteresisSeconds: 0,
  },
];

let seeded = 0;
for (const r of rules) {
  await c.rule.create({
    data: {
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
  });
  seeded++;
}
globalThis.console.log("seeded", seeded, "rules");
await c.$disconnect();
