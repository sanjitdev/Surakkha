/**
 * Narrow Prisma slice `IncidentStateRepository` + the writer
 * `applyTransition` + wire-row adapters. The `$transaction`
 * callback runs (incident update + event write + optional
 * notification write) atomically; `tx` is shaped as
 * `IncidentStateRepository` so the same calls work without
 * re-binding.
 */
import type {
  ActionVerb,
  IncidentEventPayload,
  IncidentEventType,
  IncidentPayload,
  IncidentState,
  TransitionResult,
} from "@surakkha/shared/incident";

/** Full state of a single incident row. Mirrors `IncidentPayload`
 *  but with Date objects (Prisma returns Date, not ISO 8601). */
export interface IncidentRow {
  readonly id: string;
  readonly deviceId: string;
  readonly severity: string;
  readonly metric: string;
  readonly value: number;
  readonly openedAt: Date;
  readonly state: IncidentState;
  readonly assigneeUserId: string | null;
  readonly acknowledgedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly updatedAt: Date;
}

/** Single IncidentEvent audit row. Mirrors the Prisma
 *  `IncidentEvent` model. */
export interface IncidentEventRow {
  readonly id: string;
  readonly incidentId: string;
  readonly actorUserId: string | null;
  readonly type: IncidentEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/** The narrow slice the writer needs from the real Prisma client.
 *  Methods NOT exposed (intentionally) are out of scope for the
 *  writer — the route layer uses its own slice. */
export interface IncidentStateRepository {
  readonly incident: {
    findUnique(args: { readonly where: { readonly id: string } }): Promise<IncidentRow | null>;
    /** Read path for `/api/incidents/active`. `select` is `never`
     *  (a follow-up should add a separate `findManyLite` for a
     *  narrowed projection). `take` is the CALLER's responsibility
     *  (the active endpoint is un-paginated; future pagination
     *  threads `take` from a `?limit=` query param, not a silent
     *  data-layer cap). */
    findMany(args: {
      readonly where?: {
        readonly state?: { readonly not: IncidentState };
        /** Technician viewer filter. Admin/Operator/Viewer see
         *  every non-RESOLVED row. SHARED scope — handlers that
         *  reuse this method MUST consciously decide whether to
         *  thread `assigneeUserId` for Technicians or fall back
         *  to the global view. */
        readonly assigneeUserId?: string;
      };
      readonly orderBy?: { readonly openedAt: "desc" };
      readonly take?: number;
      readonly select?: never;
    }): Promise<IncidentRow[]>;
    /** Optimistic concurrency: the route passes the row's
     *  `updatedAt` in `where`; concurrent writers see `count: 0`
     *  → 409. */
    updateMany(args: {
      readonly where: {
        readonly id: string;
        readonly updatedAt: Date;
      };
      readonly data: {
        readonly state: IncidentState;
        readonly assigneeUserId: string | null;
        readonly acknowledgedAt: Date | null;
        readonly resolvedAt: Date | null;
      };
    }): Promise<{ readonly count: number }>;
  };
  readonly incidentEvent: {
    create(args: {
      readonly data: {
        readonly incidentId: string;
        readonly actorUserId: string | null;
        readonly type: IncidentEventType;
        readonly payload: Readonly<Record<string, unknown>>;
      };
    }): Promise<IncidentEventRow>;
    /** Read path for `/api/incidents/:id/events` (the detail-page
     *  audit timeline). Filters by `incidentId`; `orderBy` accepts
     *  `createdAt: "asc" | "desc"`. Wire-shape conversion happens
     *  in `incidentEventRowToPayload`. */
    findMany(args: {
      readonly where: { readonly incidentId: string };
      readonly orderBy?: { readonly createdAt: "asc" | "desc" };
    }): Promise<IncidentEventRow[]>;
  };
  /** `notification:critical` write site — fires when a technician
   *  submits an UNSAFE outcome. Lives inside the same
   *  `$transaction` as the incident update + event create.
   *  Idempotency is enforced by the partial unique index; the
   *  P2002 catch is the caller's responsibility. */
  readonly notification: {
    create(args: {
      readonly data: {
        readonly severity: "warning" | "critical";
        readonly incidentId: string | null;
        readonly alertId: string | null;
        readonly recipientRole: "Admin" | "Operator" | "Technician" | "Viewer";
      };
    }): Promise<{ readonly id: string }>;
  };
  /** `$transaction` wrapper. Callback runs (incident update +
   *  event create + optional notification create) atomically.
   *  `tx` is shaped as `IncidentStateRepository` so the same
   *  calls work without re-binding. */
  $transaction<T>(cb: (tx: IncidentStateRepository) => Promise<T>): Promise<T>;
}

/** Adapter — narrow the real `@prisma/client` to the
 *  `IncidentStateRepository` slice. */
export const resolveIncidentStateRepository = (prisma: unknown): IncidentStateRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    incident: {
      findUnique: (args) => client.incident.findUnique(args) as Promise<IncidentRow | null>,
      findMany: (args) => client.incident.findMany(args) as Promise<IncidentRow[]>,
      updateMany: (args) => client.incident.updateMany(args) as Promise<{ readonly count: number }>,
    },
    incidentEvent: {
      create: (args) => client.incidentEvent.create(args) as Promise<IncidentEventRow>,
      findMany: (args) => client.incidentEvent.findMany(args) as Promise<IncidentEventRow[]>,
    },
    notification: {
      create: (args) => client.notification.create(args) as Promise<{ readonly id: string }>,
    },
    $transaction: <T>(cb: (tx: IncidentStateRepository) => Promise<T>): Promise<T> =>
      client.$transaction(cb) as Promise<T>,
  };
};

/**
 * Inputs to `applyTransition`. The route layer resolves the
 * `IncidentPayload` from the row + the parsed body, then hands
 * the result here.
 */
export interface ApplyTransitionInput {
  readonly currentRow: IncidentRow;
  readonly result: TransitionResult;
  readonly actorUserId: string | null;
  /**
   * For `assign` only — the new assignee's User.id. Ignored for
   * other verbs.
   */
  readonly assigneeUserId?: string | null;
  /** When true, also writes a `notification:critical` row inside
   *  the same `$transaction` as the incident update + event
   *  create. Set by the route layer when the next state is
   *  `UNSAFE`. */
  readonly writeCriticalNotification?: boolean;
}

export interface ApplyTransitionOutput {
  readonly nextRow: IncidentRow;
  readonly event: IncidentEventRow;
  readonly notificationId: string | null;
}

/**
 * Apply a successful `transition()` result inside a `$transaction`.
 *
 * Steps:
 *   1. Stamp the next-state `Incident.update` with optimistic
 *      concurrency on `updatedAt`. A `count: 0` return means
 *      a concurrent writer beat us — the route layer maps that
 *      to 409.
 *   2. Write the `IncidentEvent` row (one per call).
 *   3. If `writeCriticalNotification === true`, also write a
 *      `Notification` row inside the same `$transaction`.
 *
 * If `result.ok === false`, this function THROWS — the route
 * layer should never call `applyTransition` with a typed
 * error result. The router's pre-check enforces this.
 */
export const applyTransition = async (
  repo: IncidentStateRepository,
  input: ApplyTransitionInput,
): Promise<ApplyTransitionOutput> => {
  if (!input.result.ok) {
    throw new Error(`applyTransition called with invalid result: ${JSON.stringify(input.result)}`);
  }
  const { currentRow, result, actorUserId, assigneeUserId, writeCriticalNotification } = input;
  const nextState = result.next_state;
  const at = new Date(result.at);

  // Stamp acknowledged_at on the first transition out of OPEN;
  // subsequent transitions preserve the value.
  const ackedAt =
    currentRow.acknowledgedAt ?? (nextState !== "OPEN" && nextState !== "REOPENED" ? at : null);
  // Stamp resolved_at on RESOLVED; clear it on RESOLVED → OPEN so
  // `state === "OPEN" && resolvedAt IS NULL` correctly categorises
  // a re-opened incident as in-flight. The historical resolved_at
  // is preserved in the `IncidentEvent` audit row.
  const resolvedAt =
    nextState === "RESOLVED"
      ? at
      : nextState === "OPEN" && currentRow.state === "RESOLVED"
        ? null
        : currentRow.resolvedAt;

  // For `assign`, the new assignee is set; for other verbs, the
  // current value is preserved.
  const newAssignee =
    input.result.event_type === "assign" ? (assigneeUserId ?? null) : currentRow.assigneeUserId;

  return repo.$transaction(async (tx) => {
    // Step 1: optimistic-concurrency update. `reopen` forces
    // `severity: "critical"` so the row immediately surfaces in
    // the "Open · Critical" Kanban column. The conditional spread
    // is the type-safe alternative to `severity: undefined` —
    // Prisma's updateMany rejects explicit undefined for required
    // scalars.
    const reopenForcesCritical = result.event_type === "reopen";
    const update = await tx.incident.updateMany({
      where: { id: currentRow.id, updatedAt: currentRow.updatedAt },
      data: {
        state: nextState,
        assigneeUserId: newAssignee,
        acknowledgedAt: ackedAt,
        resolvedAt,
        ...(reopenForcesCritical ? { severity: "critical" as const } : {}),
      },
    });
    if (update.count === 0) {
      // Optimistic-concurrency loser. The route layer catches
      // this and maps to 409 + writes an invalid_transition_
      // attempt event for the audit trail.
      throw new OptimisticConcurrencyError(currentRow.id);
    }

    // Step 2: write the audit event.
    const event = await tx.incidentEvent.create({
      data: {
        incidentId: currentRow.id,
        actorUserId,
        type: result.event_type,
        payload: result.event_payload,
      },
    });

    // Step 3: optional critical notification.
    let notificationId: string | null = null;
    if (writeCriticalNotification === true && nextState === "UNSAFE") {
      const notification = await tx.notification.create({
        data: {
          severity: "critical",
          incidentId: currentRow.id,
          alertId: null,
          recipientRole: "Operator",
        },
      });
      notificationId = notification.id;
    }

    // Re-read the row to return the post-update timestamps.
    const nextRow = await tx.incident.findUnique({ where: { id: currentRow.id } });
    if (nextRow === null) {
      throw new Error(`incident ${currentRow.id} disappeared after update`);
    }

    return { nextRow, event, notificationId };
  });
};

/**
 * Sentinel error for optimistic-concurrency losers. The route
 * layer catches this specifically and maps to HTTP 409.
 */
export class OptimisticConcurrencyError extends Error {
  constructor(public readonly incidentId: string) {
    super(`optimistic concurrency loser on incident ${incidentId}`);
    this.name = "OptimisticConcurrencyError";
  }
}

/** Build the wire-row `IncidentPayload` from a Prisma row. Pure
 *  helper (no IO); lives here because it has no other natural home. */
export const incidentRowToPayload = (row: IncidentRow): IncidentPayload => ({
  id: row.id,
  device_id: row.deviceId,
  severity: row.severity as IncidentPayload["severity"],
  metric: row.metric,
  value: row.value,
  opened_at:
    row.openedAt instanceof Date
      ? row.openedAt.toISOString()
      : new Date(row.openedAt).toISOString(),
  state: row.state,
  assignee_user_id: row.assigneeUserId,
  acknowledged_at:
    row.acknowledgedAt === null
      ? null
      : row.acknowledgedAt instanceof Date
        ? row.acknowledgedAt.toISOString()
        : new Date(row.acknowledgedAt).toISOString(),
  resolved_at:
    row.resolvedAt === null
      ? null
      : row.resolvedAt instanceof Date
        ? row.resolvedAt.toISOString()
        : new Date(row.resolvedAt).toISOString(),
});

/** Build the wire-row `IncidentEventPayload` from a Prisma
 *  `IncidentEvent` row. The `payload` is freeform; we pass it
 *  through unchanged. The detail page renders it as JSON. */
export const incidentEventRowToPayload = (row: IncidentEventRow): IncidentEventPayload => ({
  id: row.id,
  incident_id: row.incidentId,
  actor_user_id: row.actorUserId,
  type: row.type,
  payload: { ...row.payload },
  created_at:
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString(),
});

/**
 * Re-export the action-verb type for the route layer.
 */
export type { ActionVerb };
