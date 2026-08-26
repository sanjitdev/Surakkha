/**
 * Pure acknowledge helper — Story 3.5.
 *
 * Builds the Prisma `updateMany` payload that the acknowledge router
 * uses for the compare-and-set write. Splitting this out of
 * `acknowledgeRouter.ts` keeps the router under the lint `max-lines`
 * ceiling (500) and gives the helper a unit-testable surface.
 *
 * The compare-and-set (`where: { id, acknowledgedAt: null }`,
 * `data: { acknowledgedAt, acknowledgedByUserId }`) is atomic at the
 * row level — Postgres evaluates the predicate under the row's
 * tuple lock. Two simultaneous acks: exactly one returns `count === 1`
 * (the first writer commits); the other returns `count === 0` and the
 * router follows up with `findUnique` to return the existing row's
 * timestamp (idempotency path). See
 * `spec-3-5-alert-lifecycle.md:AC1e` + the resolved decision in the
 * Spec Change Log ("ACK race primitive → Compare-and-set via
 * `updateMany({ where: { id, acknowledgedAt: null }, ... })`").
 *
 * The router MUST use this helper so the wire payload and the DB
 * row always agree on `acknowledgedAt` (no double-read of `now()`):
 * a single `now()` is passed in and stamped on both surfaces. See
 * `spec-3-5-alert-lifecycle.md:AC1c`.
 */
export interface BuildAcknowledgeUpdateInput {
  readonly alertId: string;
  readonly actorUserId: string;
  readonly now: Date;
}

export interface BuildAcknowledgeUpdateResult {
  readonly where: {
    readonly id: string;
    readonly acknowledgedAt: null;
  };
  readonly data: {
    readonly acknowledgedAt: Date;
    readonly acknowledgedByUserId: string;
  };
}

/**
 * Build the `updateMany` payload for the compare-and-set. Pure: no IO,
 * no clock reads, no Prisma access. The `now` is the SAME Date instance
 * the router will return on the response body — passing it in lets the
 * caller keep one read of the clock across both surfaces.
 */
export const buildAcknowledgeUpdate = (
  input: BuildAcknowledgeUpdateInput,
): BuildAcknowledgeUpdateResult => ({
  where: {
    id: input.alertId,
    acknowledgedAt: null,
  },
  data: {
    acknowledgedAt: input.now,
    acknowledgedByUserId: input.actorUserId,
  },
});
