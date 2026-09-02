/**
 * IO helpers for the rule engine's open/clear transitions. The two
 * helpers wrap (findOpenAlert, alert.{create|update},
 * ruleDebounceState.upsert) in `$transaction`. The socket emit
 * (open only) fires AFTER the transaction commits; a schema-parse
 * failure logs the wire drift and skips the emit.
 */
import {
  AlertOpenedEventSchema,
  IncidentOpenedEventSchema,
  type RuleMetric,
} from "@surakkha/shared";

import {
  type NotificationWriterRepository,
  writeWarningNotification,
} from "../notifications/notificationWriter";

import { type BreachTransition } from "./debounce";
import { findOpenAlert, type PrismaAlertReader } from "./findOpenAlert";
import { type InstallRuleEngineHooksDeps } from "./hooks";
import { buildIncidentPayload, shouldCreateIncident } from "./incidentFromAlert";

import type { BroadcastTarget } from "../ingest/frame";

// Local const — keeps this module free of the hooks.ts import for
// the P2002 case.
const PRISMA_P2002 = "P2002";

export const applyTransition = async (
  deps: InstallRuleEngineHooksDeps,
  args: {
    readonly broadcast: BroadcastTarget;
    readonly ctx: { deviceId: string; metricValue: number };
    readonly transition: BreachTransition;
    readonly slot: { inViolationSince: Date | null; clearedSince: Date | null };
  },
): Promise<void> => {
  if (args.transition.kind === "open") {
    await applyOpenTransition(deps, args);
    return;
  }
  await applyClearTransition(deps, args);
};

/** Open path: `$transaction` wraps (findOpenAlert, alert.create,
 *  ruleDebounceState.upsert). The real alertId is resolved inside
 *  the transaction. */
const applyOpenTransition = async (
  deps: InstallRuleEngineHooksDeps,
  args: {
    readonly broadcast: BroadcastTarget;
    readonly ctx: { deviceId: string; metricValue: number };
    readonly transition: BreachTransition;
    readonly slot: { inViolationSince: Date | null; clearedSince: Date | null };
  },
): Promise<void> => {
  if (args.transition.kind !== "open") return;
  const { transition } = args;
  const { broadcast, ctx, slot } = args;
  const { deviceId, metricValue } = ctx;
  let alertId: string | null = null;
  let incidentId: string | null = null;
  let suppressedExisting = false;

  await deps.alertState.$transaction(async (tx) => {
    // Idempotency fast path — the partial unique index is the safety
    // net for the race; this lookup avoids the INSERT attempt.
    const existing = await findOpenAlert(tx as PrismaAlertReader, {
      deviceId,
      metric: transition.metric,
      severity: transition.severity,
    });
    if (existing !== null) {
      console.warn(
        `[alerts] duplicate open suppressed device=${deviceId} alertId=${existing.id} metric=${transition.metric} severity=${transition.severity}`,
      );
      suppressedExisting = true;
      // Advance `inViolationSince` even when the alert is suppressed
      // so the de-bounce window math sees the freshest violation start.
      await tx.ruleDebounceState.upsert({
        where: {
          deviceId_metric_severity: {
            deviceId,
            metric: transition.metric,
            severity: transition.severity,
          },
        },
        create: {
          deviceId,
          metric: transition.metric,
          severity: transition.severity,
          inViolationSince: slot.inViolationSince,
          clearedSince: null,
        },
        update: {
          inViolationSince: slot.inViolationSince,
        },
      });
      return;
    }

    let createdAlertId: string;
    try {
      const created = await tx.alert.create({
        data: {
          deviceId,
          ruleId: transition.ruleId,
          severity: transition.severity,
          metric: transition.metric,
          openedAt: transition.openedAt,
        },
      });
      createdAlertId = created.id;
    } catch (err) {
      // Race loss: partial unique index raised P2002.
      if (isPrismaP2002(err)) {
        console.warn(
          `[alerts] duplicate open suppressed (race) device=${deviceId} metric=${transition.metric} severity=${transition.severity}`,
        );
        suppressedExisting = true;
        await tx.ruleDebounceState.upsert({
          where: {
            deviceId_metric_severity: {
              deviceId,
              metric: transition.metric,
              severity: transition.severity,
            },
          },
          create: {
            deviceId,
            metric: transition.metric,
            severity: transition.severity,
            inViolationSince: slot.inViolationSince,
            clearedSince: null,
          },
          update: {
            inViolationSince: slot.inViolationSince,
          },
        });
        return;
      }
      throw err;
    }

    // Auto-create Incident from warning/critical Alert. Lives inside
    // the same `$transaction` so the Incident row commits atomically.
    // Info-severity alerts do NOT create Incidents.
    if (shouldCreateIncident(transition.severity)) {
      try {
        const created = await tx.incident.create({
          data: buildIncidentPayload({
            deviceId,
            severity: transition.severity,
            metric: transition.metric,
            value: metricValue,
            openedAt: transition.openedAt,
          }),
        });
        incidentId = created.id;

        // `notification:warning` write site — same `$transaction`
        // so the (Alert + Incident + Notification) rows commit as one
        // unit. Idempotent via the partial unique index.
        await writeWarningNotification(tx as unknown as NotificationWriterRepository, {
          incidentId: created.id,
          alertId: createdAlertId,
        });
      } catch (err) {
        console.warn(
          `[alerts] incident auto-create failed; alert path continues device=${deviceId} metric=${transition.metric} severity=${transition.severity}`,
          err,
        );
      }
    }

    // Atomic with the alert row creation.
    await tx.ruleDebounceState.upsert({
      where: {
        deviceId_metric_severity: {
          deviceId,
          metric: transition.metric,
          severity: transition.severity,
        },
      },
      create: {
        deviceId,
        metric: transition.metric,
        severity: transition.severity,
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
      update: {
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
    });
    alertId = createdAlertId;
  });

  if (suppressedExisting || alertId === null) {
    return;
  }

  // Post-commit emit. If the emit itself fails, the Alert row exists
  // and the next eval pass can re-emit.
  const resolvedAlertId = alertId;
  const payload = {
    alert_id: resolvedAlertId,
    device_id: deviceId,
    metric: transition.metric,
    severity: transition.severity,
    opened_at: transition.openedAt.toISOString(),
    rule_id: transition.ruleId,
    value: metricValue,
  };
  const parsed = AlertOpenedEventSchema.safeParse(payload);
  if (parsed.success) {
    broadcast.to(`device:${deviceId}`).emit("alert:opened", parsed.data);
  } else {
    // Wire drift — Alert row IS committed; client just won't see the emit.
    console.warn(
      `[alerts] opened emit skipped: AlertOpenedEventSchema parse failed device=${deviceId} alertId=${resolvedAlertId} metric=${transition.metric} severity=${transition.severity}`,
      parsed.error,
    );
  }
  console.warn(
    `[alerts] opened device=${deviceId} alertId=${resolvedAlertId} ruleId=${transition.ruleId} severity=${transition.severity} openedAt=${transition.openedAt.toISOString()}`,
  );

  // `incident:opened` emit fires ONLY when an Incident row was
  // auto-created. Independent of the alert emit's outcome.
  if (incidentId !== null) {
    const incidentPayload = {
      incident_id: incidentId,
      device_id: deviceId,
      severity: transition.severity,
      metric: transition.metric,
      value: metricValue,
      opened_at: transition.openedAt.toISOString(),
      alert_id: resolvedAlertId,
      actor_user_id: null,
    };
    const parsedIncident = IncidentOpenedEventSchema.safeParse(incidentPayload);
    if (parsedIncident.success) {
      broadcast.to(`device:${deviceId}`).emit("incident:opened", parsedIncident.data);
      broadcast.to(`incident:${incidentId}`).emit("incident:opened", parsedIncident.data);
    } else {
      console.warn(
        `[incidents] opened emit skipped: IncidentOpenedEventSchema parse failed device=${deviceId} incidentId=${incidentId} metric=${transition.metric} severity=${transition.severity}`,
        parsedIncident.error,
      );
    }
    // Observability log on every auto-created Incident; `verb: "auto_create"`
    // distinguishes system-driven from operator-driven transitions.
    console.warn(
      JSON.stringify({
        event: "incident_transition",
        incident_id: incidentId,
        from: null,
        to: "OPEN",
        verb: "auto_create",
        actor_user_id: null,
        at: transition.openedAt.toISOString(),
      }),
    );
  }
};

/** Clear path: `$transaction` wraps (findOpenAlert, alert.update,
 *  ruleDebounceState.upsert). The transition carries the slot's
 *  `(deviceId, metric, severity)`; the IO layer resolves the real
 *  alertId via the partial-index lookup INSIDE the transaction. */
const applyClearTransition = async (
  deps: InstallRuleEngineHooksDeps,
  args: {
    readonly broadcast: BroadcastTarget;
    readonly ctx: { deviceId: string; metricValue: number };
    readonly transition: BreachTransition;
    readonly slot: { inViolationSince: Date | null; clearedSince: Date | null };
  },
): Promise<void> => {
  if (args.transition.kind !== "clear") return;
  const { transition } = args;
  const { slot } = args;
  const { deviceId } = transition;
  let clearedAlertId: string | null = null;
  let suppressedNull = false;

  await deps.alertState.$transaction(async (tx) => {
    const existing = await findOpenAlert(tx as PrismaAlertReader, {
      deviceId,
      metric: transition.metric,
      severity: transition.severity,
    });
    if (existing === null) {
      // No-op: clear transition for a slot with no open row.
      // Log the anomaly for operator diagnosis.
      console.warn(
        `[alerts] clear transition with no open alert device=${deviceId} metric=${transition.metric} severity=${transition.severity}`,
      );
      suppressedNull = true;
      await tx.ruleDebounceState.upsert({
        where: {
          deviceId_metric_severity: {
            deviceId,
            metric: transition.metric,
            severity: transition.severity,
          },
        },
        create: {
          deviceId,
          metric: transition.metric,
          severity: transition.severity,
          inViolationSince: slot.inViolationSince,
          clearedSince: slot.clearedSince,
        },
        update: {
          inViolationSince: slot.inViolationSince,
          clearedSince: slot.clearedSince,
        },
      });
      return;
    }

    // Atomic with the state upsert.
    await tx.alert.update({
      where: { id: existing.id },
      data: { clearedAt: transition.clearedAt },
    });
    await tx.ruleDebounceState.upsert({
      where: {
        deviceId_metric_severity: {
          deviceId,
          metric: transition.metric,
          severity: transition.severity,
        },
      },
      create: {
        deviceId,
        metric: transition.metric,
        severity: transition.severity,
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
      update: {
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
    });
    clearedAlertId = existing.id;
  });

  if (suppressedNull || clearedAlertId === null) {
    return;
  }
  const resolvedAlertId = clearedAlertId;
  console.warn(
    `[alerts] cleared alertId=${resolvedAlertId} clearedAt=${transition.clearedAt.toISOString()}`,
  );
};

/** Persist one slot of `DebounceState` to Postgres. Best-effort
 *  outside the transaction — a transient DB outage logs but does
 *  not fail the eval path. Called for slots whose state changed
 *  but didn't transition. */
export const persistStateSlot = async (
  deps: InstallRuleEngineHooksDeps,
  ctx: {
    readonly deviceId: string;
    readonly slotKey: { metric: RuleMetric; severity: "info" | "warning" | "critical" };
    readonly slot: { inViolationSince: Date | null; clearedSince: Date | null };
  },
): Promise<void> => {
  const { deviceId, slotKey, slot } = ctx;
  try {
    await deps.alertState.ruleDebounceState.upsert({
      where: {
        deviceId_metric_severity: {
          deviceId,
          metric: slotKey.metric,
          severity: slotKey.severity,
        },
      },
      create: {
        deviceId,
        metric: slotKey.metric,
        severity: slotKey.severity,
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
      update: {
        inViolationSince: slot.inViolationSince,
        clearedSince: slot.clearedSince,
      },
    });
  } catch (err) {
    console.warn(
      `[debounce] state upsert failed device=${deviceId} metric=${slotKey.metric} severity=${slotKey.severity}`,
      err,
    );
  }
};

/** Narrow type guard for Prisma's P2002 unique-constraint violation.
 *  The minimal `code` check is what the engine + de-bounce rely on. */
export const isPrismaP2002 = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const { code } = err as { code?: unknown };
  return code === PRISMA_P2002;
};
