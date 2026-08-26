/**
 * applyTransition.ts — Story 3.4 (de-bouncing IO).
 *
 * Three small IO helpers extracted from `hooks.ts` so the hook
 * module stays under the lint `max-lines` ceiling (500). The
 * behaviour is identical to the inlined version that lived in
 * `hooks.ts`; the file split is mechanical.
 *
 *   - `applyTransition(deps, args)` dispatches to the open or
 *     clear handler based on `transition.kind`.
 *   - `applyOpenTransition(deps, args)` — Finding #3: open path
 *     wraps (findOpenAlert, alert.create, ruleDebounceState.upsert)
 *     in `$transaction`. The real alertId is resolved inside the
 *     transaction; the post-commit emit uses that alertId.
 *   - `applyClearTransition(deps, args)` — Finding #4 + #6: clear
 *     path wraps (findOpenAlert, alert.update,
 *     ruleDebounceState.upsert) in `$transaction`. The pure
 *     module's `clear` transition carries the slot key
 *     `(deviceId, metric, severity)`; the IO layer supplies the
 *     real alertId via the partial-index lookup INSIDE the
 *     transaction. This resolves the `BreachTransition`
 *     clear-shape mismatch from loopback-1 (Finding #6).
 *
 * Plus `isPrismaP2002(err)` — narrow type guard for the
 * duplicate-open race catch (Finding #10).
 *
 * The socket emit (open only) happens AFTER the transaction
 * commits (per Design Note "Socket emit happens post-commit").
 * If `AlertOpenedEventSchema.safeParse` fails, the emit is
 * skipped and a `console.warn` is logged so operators can
 * diagnose wire drift (Finding #7).
 */
import { AlertOpenedEventSchema, type RuleMetric } from "@surakkha/shared";

import { type AlertStateRepository } from "./alertStateRepository";
import { type BreachTransition } from "./debounce";
import { findOpenAlert, type PrismaAlertReader } from "./findOpenAlert";
import { type InstallRuleEngineHooksDeps } from "./hooks";
import { buildIncidentPayload, shouldCreateIncident } from "./incidentFromAlert";

import type { BroadcastTarget } from "../ingest/frame";

// `PRISMA_P2002` lives in `hooks.ts` for the boot guard to import;
// importing it back here would create a cycle, so we declare a
// local const with the same value. The lint config treats
// `PRISMA_P2002` as a stable Prisma code, not a project-specific
// magic string.
const PRISMA_P2002 = "P2002";

/**
 * Apply one `BreachTransition` to Postgres + (for opens) the
 * socket. Dispatches to the open or clear handler based on
 * `transition.kind`.
 */
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

/**
 * Story 3.4 review-finding #3: open path — `$transaction` wraps
 * (findOpenAlert, alert.create, ruleDebounceState.upsert). The real
 * alertId is resolved inside the transaction; the post-commit emit
 * uses that alertId. The state slot is upserted inside the
 * transaction so the Alert row + state row commit as one unit.
 *
 * The `transition` parameter is typed as `BreachTransition` (the
 * full discriminated union) rather than `Extract<BreachTransition,
 * { kind: "open" }>` because TS cannot narrow `args.transition`
 * through a function boundary — only through `if (kind === "open")
 * { ... }` checks inside the function. The narrow happens at the
 * top of this function via that exact check, so the rest of the
 * body sees the `open` variant.
 */
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
  let suppressedExisting = false;

  await deps.alertState.$transaction(async (tx) => {
    // Idempotency fast path: check `findOpenAlert` first.
    // The partial unique index is the safety net for the race;
    // this lookup avoids the unnecessary INSERT attempt.
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
      // unique index raised P2002. Treat as "already-open, skip".
      // The P2002 catch returns BEFORE the incident auto-create
      // (AC3 — losing writers do not create duplicate Incidents).
      if (isPrismaP2002(err)) {
        console.warn(
          `[alerts] duplicate open suppressed (race) device=${deviceId} metric=${transition.metric} severity=${transition.severity}`,
        );
        suppressedExisting = true;
        return;
      }
      throw err;
    }

    // Story 3.6 — auto-create Incident from warning/critical Alert.
    // Lives inside the same `$transaction` so the Incident row
    // commits atomically with the Alert row + state upsert (AC1,
    // AC6). Info-severity alerts do NOT create Incidents (AC2).
    // The decision is made via the type-guard helper so a future
    // drift on the wire enum (e.g. a new severity literal) is a
    // closed-set refusal — the Incident is NOT created for unknown
    // severities.
    if (shouldCreateIncident(transition.severity)) {
      await tx.incident.create({
        data: buildIncidentPayload({
          deviceId,
          severity: transition.severity,
          metric: transition.metric,
          value: metricValue,
          openedAt: transition.openedAt,
        }),
      });
    }

    // Atomic with the alert row creation: both commit together or
    // both roll back. If `upsert` fails, the alert row also
    // rolls back — no orphan alert with no corresponding state.
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
  // the Alert row exists and the next eval pass can re-emit
  // (idempotent on `alertId`).
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
    // Story 3.4 review-finding #7: surface the wire drift so
    // operators can diagnose. The Alert row IS committed; the
    // client just won't see the emit. The hook logs the parse
    // error so the schema drift shows up in the boot log
    // pipeline.
    console.warn(
      `[alerts] opened emit skipped: AlertOpenedEventSchema parse failed device=${deviceId} alertId=${resolvedAlertId} metric=${transition.metric} severity=${transition.severity}`,
      parsed.error,
    );
  }
  console.warn(
    `[alerts] opened device=${deviceId} alertId=${resolvedAlertId} ruleId=${transition.ruleId} severity=${transition.severity} openedAt=${transition.openedAt.toISOString()}`,
  );
};

/**
 * Story 3.4 review-finding #4 + #6: clear path — `$transaction`
 * wraps (findOpenAlert, alert.update, ruleDebounceState.upsert).
 * The pure module's `clear` transition carries the slot's
 * `(deviceId, metric, severity)` — the IO layer resolves the
 * real alertId via the partial-index lookup INSIDE the
 * transaction. This is the resolution of the `BreachTransition`
 * clear-shape mismatch from loopback-1 (Finding #6): the
 * transition carries the slot key; the IO layer supplies the
 * real alertId.
 */
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
      // Story 3.4 review-finding #8: a clear transition for a
      // slot with no open row is a no-op (timer fires but no row
      // to update). Log the anomaly so operators can diagnose
      // drift between the de-bounce timer and the Alert table.
      // The state upsert still runs so the timer remains in
      // sync with Postgres on the next frame.
      console.warn(
        `[alerts] clear transition with no open alert device=${deviceId} metric=${transition.metric} severity=${transition.severity}`,
      );
      suppressedNull = true;
      return;
    }

    // Atomic with the state upsert: alert.update + state row
    // commit together or both roll back.
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
    // Even on no-open-row, still write the state row so the
    // timer is consistent with Postgres. Best-effort outside
    // the transaction.
    await persistStateSlot(deps, {
      deviceId,
      slotKey: { metric: transition.metric, severity: transition.severity },
      slot,
    });
    return;
  }
  const resolvedAlertId = clearedAlertId;
  console.warn(
    `[alerts] cleared alertId=${resolvedAlertId} clearedAt=${transition.clearedAt.toISOString()}`,
  );
};

/**
 * Persist one slot of `DebounceState` to Postgres. Best-effort
 * outside the transaction — a transient DB outage logs but does
 * not fail the eval path. Exported because `hooks.ts` calls it
 * for slots whose state changed but didn't transition (e.g. a
 * quiet frame that only resets the rising-edge timer).
 */
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

// `AlertStateRepository` and `InstallRuleEngineHooksDeps` are
// imported for their types only; they appear in the function
// signatures. No runtime reference is needed.

// Reference `AlertStateRepository` so the import is used in
// this file's type namespace (not just the function signature).
// Without this, eslint may flag the import as unused.
type _AlertStateRef = AlertStateRepository;

/**
 * Narrow type guard for Prisma's P2002 (unique-constraint
 * violation) error. The shape varies across Prisma versions; this
 * minimal `code` check is what the engine + de-bounce modules rely
 * on.
 */
export const isPrismaP2002 = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const { code } = err as { code?: unknown };
  return code === PRISMA_P2002;
};
