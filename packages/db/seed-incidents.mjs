/* eslint-env node */
// Quick dev seed — creates a handful of demo Incidents (one per device
// with an out-of-range scenario) so the Kanban + IncidentDetailPage
// have content to render. Bypasses the rule engine because the cached
// api image was built before Story 3.4's de-bounce wiring; this seed
// is the fastest path to a populated Kanban for visual verification
// of Story 4.4's surfaces.
import { PrismaClient } from "@prisma/client";

const c = new PrismaClient();

const OP_ALPHA_ID = "00000000-0000-4000-8000-00000000a002";
const TECH_ALPHA_ID = "00000000-0000-4000-8000-00000000a003";

const devices = [
  {
    id: "9b1c4f00-0000-4000-8000-000000000001",
    scenario: "Normal",
    severity: "warning",
    metric: "tds_ppm",
    value: 380,
    state: "ACKNOWLEDGED",
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000002",
    scenario: "RisingTDS",
    severity: "critical",
    metric: "tds_ppm",
    value: 1500,
    state: "INSPECTING",
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000003",
    scenario: "TurbiditySpike",
    severity: "critical",
    metric: "turbidity_ntu",
    value: 8.2,
    state: "OPEN",
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000004",
    scenario: "ChlorineDrop",
    severity: "critical",
    metric: "chlorine_ppm",
    value: 0.05,
    state: "MONITORING",
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000005",
    scenario: "Offline",
    severity: "warning",
    metric: "water_level_cm",
    value: 18,
    state: "SAFE",
  },
];

// Find the matching Rule id for each incident so the Alert row's
// `ruleId` FK resolves. Pick any active rule whose metric+severity
// match the incident. Threshold value is irrelevant to the Alert.
const findRule = async (metric, severity) => {
  const r = await c.rule.findFirst({
    where: { metric, severity, isActive: true },
    select: { id: true },
  });
  if (!r) throw new Error(`no matching rule for ${metric} ${severity}`);
  return r.id;
};

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);

let seeded = 0;
for (const d of devices) {
  const ruleId = await findRule(d.metric, d.severity);

  // Anchor timeline on the alert open moment (60 min ago for all).
  const openedAt = minutesAgo(60);
  const acknowledgedAt = minutesAgo(45);

  // The alert always opens first.
  const alert = await c.alert.create({
    data: {
      deviceId: d.id,
      ruleId,
      severity: d.severity,
      metric: d.metric,
      openedAt,
    },
  });

  // Decide acknowledgement / assignment based on state.
  const isAssigned = d.state !== "OPEN";
  const isInspected = d.state === "INSPECTING" || d.state === "MONITORING" || d.state === "SAFE";
  const isMonitored = d.state === "MONITORING" || d.state === "SAFE";
  const isSafe = d.state === "SAFE";

  const incident = await c.incident.create({
    data: {
      deviceId: d.id,
      severity: d.severity,
      metric: d.metric,
      value: d.value,
      openedAt,
      state: d.state,
      assigneeUserId: isAssigned ? TECH_ALPHA_ID : null,
      acknowledgedAt: isAssigned ? acknowledgedAt : null,
      resolvedAt: isSafe ? minutesAgo(15) : null,
    },
  });

  // Build the audit timeline in chronological order.
  const events = [];

  // t+1: the rule-engine auto-create from the alert (synthetic).
  events.push({
    incidentId: incident.id,
    actorUserId: null,
    type: "invalid_transition_attempt",
    payload: { reason: "auto_create_from_alert", alertId: alert.id, value: d.value, ruleId },
    createdAt: new Date(openedAt.getTime() + 1_000),
  });

  if (isAssigned) {
    events.push({
      incidentId: incident.id,
      actorUserId: OP_ALPHA_ID,
      type: "acknowledge",
      payload: { from: "OPEN", to: "ACKNOWLEDGED" },
      createdAt: acknowledgedAt,
    });
  }

  if (isInspected) {
    events.push({
      incidentId: incident.id,
      actorUserId: TECH_ALPHA_ID,
      type: "assign",
      payload: { assigneeUserId: TECH_ALPHA_ID, from: "ACKNOWLEDGED", to: "INSPECTING" },
      createdAt: minutesAgo(30),
    });
  }

  if (isMonitored) {
    events.push({
      incidentId: incident.id,
      actorUserId: TECH_ALPHA_ID,
      type: "submit_result",
      payload: { from: "INSPECTING", to: "MONITORING", outcome: "stable" },
      createdAt: minutesAgo(20),
    });
  }

  if (isSafe) {
    events.push({
      incidentId: incident.id,
      actorUserId: TECH_ALPHA_ID,
      type: "resolve",
      payload: { from: "MONITORING", to: "SAFE", resolution: "value_returned_to_normal" },
      createdAt: minutesAgo(15),
    });
  }

  await c.incidentEvent.createMany({ data: events });
  seeded++;
}

globalThis.console.log("seeded", seeded, "incidents + alerts + events");
await c.$disconnect();
