/**
 * Pure helper that builds the Prisma `updateMany` payload for the
 * acknowledge route's compare-and-set write. Decoupling the helper
 * keeps the route under the lint `max-lines` ceiling and exposes a
 * unit-testable surface.
 *
 * The compare-and-set (`where: { id, acknowledgedAt: null }`,
 * `data: { acknowledgedAt, acknowledgedByUserId }`) is atomic at the
 * row level: Postgres evaluates the predicate under the row's tuple
 * lock. Two simultaneous acks — exactly one returns `count === 1`
 * (the first writer commits); the other returns `count === 0` and
 * the route follows up with `findUnique` to return the existing
 * row's timestamp (idempotency path).
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
 * the route returns on the response body — passing it in lets the
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
