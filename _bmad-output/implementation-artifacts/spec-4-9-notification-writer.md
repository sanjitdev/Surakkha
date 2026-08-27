# Story 4.9 — Notification Writer

**Status:** done (lands with Epic 4 foundation slice)
**Epic:** 4 — Incidents & Workflow
**Covers:** FR-28 (write side); FR-27 (UI-only delivery, deferred)
**Review loop:** TBD — depends on live-Prisma test results
**Shipped:** 2026-08-27 (Epic 4 foundation slice)

---

## Context

Per architecture §6.2, every notification the platform would have sent in v1 is recorded as a row so v2 can replay them via real channels (SMS, email, push). The platform's surface for this in v1 is the `Notification` Prisma table — a single typed destination for every notification event the engine emits.

Story 4.9 ships the **write side**: the `Notification` table (added in Story 4.2's migration), the `writeNotification()` pure repository function, and the call sites that produce `notification:critical` and `notification:warning` events.

The **read side** is deferred to Epic 5 Story 5.1 (`/admin/notifications` read view) and Story 4.10 (NotificationBell dropdown UI). This sweep ships the data layer only; the UI consumption comes in the next Epic 4 sweep.

The `notification:critical` event is emitted when an `Incident` transitions to `UNSAFE` (Story 4.7's submit-result action). The `notification:warning` event is emitted when a warning-severity `Alert` auto-creates an `Incident` (Story 3.6's path). Both call sites live in this story.

## User Story

> As a developer, I want a `Notification` row written for every `notification:critical` event, so that the platform records what _would_ have been sent in v1 and v2 can replay them via real channels.

## Acceptance Criteria

| AC  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pin                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| AC1 | `Notification` table exists with fields: `id`, `severity` enum (`info`, `warning`, `critical`), `incidentId` nullable FK to `Incident`, `alertId` nullable FK to `Alert`, `recipientRole` enum (`Admin`, `Operator`, `Technician`, `Viewer`), `createdAt`, `acknowledgedAt` nullable, `acknowledgedByUserId` nullable FK to `User`. Indexed on `(recipientRole, createdAt DESC)`. Partial unique index: `(incidentId, severity) WHERE acknowledgedAt IS NULL` for idempotency. | `psql -c '\d "Notification"'` table-existence + index-existence checks.              |
| AC2 | `writeNotification({ severity, incidentId?, alertId?, recipientRole }): Promise<Notification>` in `packages/api/src/notifications/notificationWriter.ts` is a **pure repository function** (no HTTP, no Prisma client instantiation, no socket). It catches P2002 (unique-constraint violation) and returns the existing row instead of throwing.                                                                                                                              | `notificationWriter.spec.ts` mocks + `notification-writer.spec.ts` live Prisma test. |
| AC3 | `notification:critical` is written inside `applyTransitionTx` of `packages/api/src/incidents/incidentStateRepository.ts` when `transition.to === "UNSAFE"`. The write is inside the same `$transaction` as the `Incident.update` + `IncidentEvent.create`. Atomicity pinned by the live Prisma test.                                                                                                                                                                           | `incident-state-machine.spec.ts` extension.                                          |
| AC4 | `notification:warning` is written inside `packages/api/src/rules/applyTransition.ts`'s auto-create-incident path when `severity === "warning"`. The write is a separate best-effort call (NOT in the alert's `$transaction` — the alert already committed; this is a follow-up notification write that does NOT roll back the alert).                                                                                                                                          | Live test pins the write outside the alert `$transaction`.                           |
| AC5 | Idempotent double-click: two concurrent `writeNotification` calls with the same `(incidentId, severity: critical)` resolve to the **same** `Notification` row (one wins on insert; the other catches P2002 and refetches). The test uses a `Promise.all` to fire two calls within 1ms.                                                                                                                                                                                         | Live `notification-writer.spec.ts` AC.                                               |
| AC6 | If an `Incident` already has a `critical` notification (acknowledged or not), a second `critical` notification for the same Incident is **NOT** created — the writer returns the existing row even after acknowledgement, AND a follow-up test pins that acknowledgement doesn't open a new write window until a **different** severity is requested.                                                                                                                          | Live test pins the no-op behavior.                                                   |

## Out of scope (deferred to other stories)

- The `NotificationBell` dropdown UI — Story 4.10 (deferred to next Epic 4 sweep).
- The `/admin/notifications` read view — Epic 5 Story 5.1.
- The `notification:info` writer — only `critical` and `warning` are emitted by 4.9.
- Real-time socket delivery (`notification:critical` to clients other than the dashboard) — Epic 4.4 deferred UI handles room broadcasting.
- An acknowledgement endpoint for `Notification` rows — Epic 5.
- Retention/purge of old `Notification` rows — out of scope; no v2 retention policy yet.

## Code Map

| File                                                        | Change                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/notifications/notificationWriter.ts`      | NEW — pure repository function. Catches P2002 + refetches. Returns `Notification` row. Logs `notification:critical` or `notification:warning` to `console.info` on success.                                                                                                     |
| `packages/api/src/notifications/notificationWriter.spec.ts` | NEW — RTL+server tests for the writer. Mocks the partial-index P2002 throw and verifies the no-throw + refetch path.                                                                                                                                                            |
| `packages/api/src/notifications/index.ts`                   | NEW — barrel export.                                                                                                                                                                                                                                                            |
| `packages/api/src/incidents/incidentStateRepository.ts`     | MODIFY — inside the `applyTransitionTx` writer, when `next.state === "UNSAFE"`, call `writeNotification({ severity: "critical", incidentId, recipientRole: "Admin" })` inside the SAME `$transaction`.                                                                          |
| `packages/api/src/rules/applyTransition.ts`                 | MODIFY — after the alert's `$transaction` commits (post-commit hook), when `severity === "warning"`, call `writeNotification({ severity: "warning", incidentId, alertId, recipientRole: "Operator" })`. Best-effort; failure logs `console.warn` but does not affect the alert. |
| `packages/db/prisma/notification-writer.spec.ts`            | NEW — live Prisma test, sibling of `alert-debounce.spec.ts`. Tests AC5 (idempotent double-click) + AC6 (acknowledged-doesn't-reopen).                                                                                                                                           |
| `packages/db/prisma/incident-state-machine.spec.ts`         | MODIFY — extend with AC3 (notification:critical written inside `$transaction`) and AC4 (notification:warning written post-commit).                                                                                                                                              |

## Risks / sharp edges

- **Partial unique index P2002 catch** — Prisma exposes P2002 with `target: string[]` (which columns collided). The writer's catch block must check `error.code === "P2002"` AND that the target columns include `incidentId` + `severity`, not some other unique violation (e.g., `id` PK collision — extremely unlikely but possible in test rigs).
- **Best-effort post-commit write (AC4)** — the notification write for `notification:warning` lives OUTSIDE the alert's `$transaction`. If the alert commits but the notification write fails, we have an alert but no notification. The atomic boundary is the alert row, not the notification row. Mitigation: wrap the notification write in its own try/catch with a `console.warn` log + retry-once (in-memory retry keyed on `(incidentId, severity)` for 5 seconds).
- **`recipientRole` is a free-form enum** — value `Admin` is correct here, but the helper takes a parameter so Story 4.10 / 5.1 can fan out to multiple roles (e.g., critical → all Admins; warning → Operators). The parameter is the typed seam.
- **The `acknowledgedAt` IS NULL window** — once an existing notification is acknowledged, the partial unique index allows a NEW notification with the same `(incidentId, severity)`. That's correct behavior: re-opening an acknowledged banner should re-emit. AC6 pins this.

## Implementation notes (locked)

The `writeNotification` signature:

```ts
import { Prisma } from "@prisma/client";
import { type Notification, type PrismaClient } from "@prisma/client";

export interface WriteNotificationArgs {
  readonly severity: "info" | "warning" | "critical";
  readonly incidentId?: string;
  readonly alertId?: string;
  readonly recipientRole: "Admin" | "Operator" | "Technician" | "Viewer";
}

export const writeNotification = async (
  db: PrismaClient,
  args: WriteNotificationArgs,
): Promise<Notification> => {
  try {
    const row = await db.notification.create({
      data: {
        severity: args.severity,
        incidentId: args.incidentId ?? null,
        alertId: args.alertId ?? null,
        recipientRole: args.recipientRole,
      },
    });
    console.info({
      event: "notification_written",
      id: row.id,
      severity: row.severity,
      recipientRole: row.recipientRole,
    });
    return row;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Idempotency: the partial unique index on (incidentId, severity) WHERE acknowledgedAt IS NULL
      // means a double-click within the same banner window returns the existing row.
      const existing = await db.notification.findFirst({
        where: {
          incidentId: args.incidentId ?? null,
          severity: args.severity,
          acknowledgedAt: null,
        },
      });
      if (existing !== null) return existing;
      throw err; // Some other P2002 — rethrow.
    }
    throw err;
  }
};
```

The call sites:

```ts
// inside applyTransitionTx (UNSAFE branch)
if (result.nextIncident.state === "UNSAFE") {
  await writeNotification(tx, {
    severity: "critical",
    incidentId: result.nextIncident.id,
    recipientRole: "Admin",
  });
}

// inside applyTransition.ts post-commit hook (warning)
if (transition.severity === "warning") {
  // best-effort — outside the alert's $transaction
  await writeNotification(client, {
    severity: "warning",
    incidentId: incident.id,
    alertId: createdAlertId,
    recipientRole: "Operator",
  }).catch((err) => console.warn({ event: "notification_write_failed", err }));
}
```

## Verification (after implementation)

- `pnpm --filter @surakkha/db test` — green; `notification-writer.spec.ts` covers AC5-AC6.
- `pnpm --filter @surakkha/api test` — green; `notificationWriter.spec.ts` covers AC2 (mocked P2002) + `incident-state-machine.spec.ts` extends with AC3-AC4.
- `pnpm -r typecheck` — no signature drift.
- `psql -c '\d "Notification"'` — confirms the table has the partial unique index on `(incidentId, severity) WHERE acknowledgedAt IS NULL`.
- Manual smoke (optional): boot the api, trigger a UNSAFE result, confirm `Notification` row appears with `severity: critical`, `recipientRole: Admin`.
