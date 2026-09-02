/**
 * IO helpers for the rule engine's open/clear transitions. The two
 * helpers wrap (findOpenAlert, alert.{create|update}, ruleDebounceState.upsert)
 * in `$transaction` so the Alert row + state row commit atomically.
 * The socket emit (open only) happens AFTER the transaction commits.
 * If `AlertOpenedEventSchema.safeParse` fails, the emit is skipped
 * and `console.warn` logs the wire drift.
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

// `PRISMA_P2002` lives in `hooks.ts` for the boot guard; declaring
// a local const here avoids a cycle.
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
 *  the transaction; the post-commit emit uses that alertId. */
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
  // Capture the auto-created Incident's id for the post-commit
  // `incident:opened` emit + the `notification:warning` write site.
  let incidentId: string | null = null;
  let suppressedExisting = false;

  await deps.alertState.$transaction(async (tx) => {
    // Idempotency fast path: check `findOpenAlert` first. The
    // partial unique index is the safety net for the race; this
    // lookup avoids the unnecessary INSERT attempt.
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
      // Even when the alert is suppressed, still advance the slot's
      // `inViolationSince` so subsequent frames' de-bounce window
      // math sees the freshest violation start. The state row
      // update is idempotent.
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
      // Race: another concurrent insert beat us; the partial
      // unique index raised P2002. Treat as "already-open, skip" —
      // losing writers do not create duplicate Incidents.
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
    // the same `$transaction` so the Incident row commits atomically
    // with the Alert row + state upsert. Info-severity alerts do NOT
    // create Incidents.
    //
    // Wrap the Incident + Notification writes in try/catch so a
    // non-P2002 error here does NOT propagate and abort the entire
    // `$transaction` (which would also roll back the already-
    // committed Alert row). Authors still get the Alert and the
    // open emit fires; the Incident auto-create surfaces as a
    // warning so ops can manually create one.
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

        // `notification:warning` write site. Lives INSIDE the same
        // `$transaction` so the (Alert + Incident + Notification)
        // rows commit as one unit. Idempotency via the partial
        // unique index.
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

    // Atomic with the alert row creation: both commit together or
    // both roll back.
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

  // Post-commit emit. The transaction resolved; if it had rolled
  // back, we wouldn't reach this line. If the emit itself fails,
  // the Alert row exists and the next eval pass can re-emit.
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
    // Surface the wire drift so operators can diagnose. The Alert
    // row IS committed; the client just won't see the emit.
    console.warn(
      `[alerts] opened emit skipped: AlertOpenedEventSchema parse failed device=${deviceId} alertId=${resolvedAlertId} metric=${transition.metric} severity=${transition.severity}`,
      parsed.error,
    );
  }
  console.warn(
    `[alerts] opened device=${deviceId} alertId=${resolvedAlertId} ruleId=${transition.ruleId} severity=${transition.severity} openedAt=${transition.openedAt.toISOString()}`,
  );

  // `incident:opened` socket emit. Fires ONLY when an Incident row
  // was auto-created from this transition (warning or critical). The
  // incident emit is INDEPENDENT of the alert emit's outcome — a
  // parse failure on `AlertOpenedEventSchema` does NOT short-
  // circuit this block. The two schemas drift on different axes
  // (alert has `alert_id`, `value`; incident has `incident_id`,
  // `alert_id` correlation) so a failure on one is no evidence of
  // a failure on the other.
  if (incidentId !== null) {
    const incidentPayload = {
      incident_id: incidentId,
      device_id: deviceId,
      severity: transition.severity,
      metric: transition.metric,
      value: metricValue,
      opened_at: transition.openedAt.toISOString(),
      alert_id: resolvedAlertId,
      // Parity with `IncidentStateChangedEventSchema`. The auto-
      // create path is system-driven (rule engine, not an
      // operator), so this is always null in v1 — but pinning the
      // field shape keeps the socket-emit record uniform across the
      // lifecycle.
      actor_user_id: null,
    };
    const parsedIncident = IncidentOpenedEventSchema.safeParse(incidentPayload);
    if (parsedIncident.success) {
      broadcast.to(`device:${deviceId}`).emit("incident:opened", parsedIncident.data);
      // Also broadcast on the per-incident room so the detail page
      // can refresh without a separate device subscription.
      broadcast.to(`incident:${incidentId}`).emit("incident:opened", parsedIncident.data);
    } else {
      console.warn(
        `[incidents] opened emit skipped: IncidentOpenedEventSchema parse failed device=${deviceId} incidentId=${incidentId} metric=${transition.metric} severity=${transition.severity}`,
        parsedIncident.error,
      );
    }
    // Observability log on every auto-created Incident. Same shape
    // as the router-level `incident_transition` log;
    // `verb: "auto_create"` distinguishes system-driven from
    // operator-driven transitions.
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
 *  `(deviceId, metric, severity)` — the IO layer resolves the real
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
      // A clear transition for a slot with no open row is a no-op
      // (timer fires but no row to update). Log the anomaly so
      // operators can diagnose drift between the de-bounce timer
      // and the Alert table. The state upsert runs INSIDE the tx
      // so the (correctly-rolled-back) Alert + state row commit as
      // one unit.
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

    // Atomic with the state upsert: alert.update + state row commit
    // together or both roll back.
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
 *  not fail the eval path. Called by `hooks.ts` for slots whose
 *  state changed but didn't transition. */
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

/** Narrow type guard for Prisma's P2002 (unique-constraint violation)
 *  error. The shape varies across Prisma versions; the minimal
 *  `code` check is what the engine + de-bounce modules rely on. */
export const isPrismaP2002 = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const { code } = err as { code?: unknown };
  return code === PRISMA_P2002;
};
