/**
 * Canonical HTTP error envelopes shared across api + web (ADR 0007).
 *
 * Closes the api critique P1 #3 — three distinct 409 envelope shapes
 * for `invalid_state_transition` collapse to ONE discriminated body.
 *
 * Two flavors merge into one schema via optional fields:
 *   - typed state-machine miss:   { error, from, attempted }       (no `reason`)
 *   - DB-layer concurrency:       { error, reason: "concurrent_modification" }  (no `from`/`attempted`)
 *
 * Clients discriminate on which optional fields are present; the
 * `error` discriminator is always `"invalid_state_transition"`.
 *
 * The schema is intentionally permissive (`z.string().optional()`)
 * so a future 409 reason (e.g. `"stale_state"`) can be added without
 * a schema bump on the wire — clients should validate the union of
 * `reason` values they care about in their own typed wrapper.
 */
import { z } from "zod";

export const InvalidStateTransitionEnvelopeSchema = z.object({
  error: z.literal("invalid_state_transition"),
  from: z.string().optional(),
  attempted: z.string().optional(),
  reason: z.string().optional(),
});
export type InvalidStateTransitionEnvelope = z.infer<typeof InvalidStateTransitionEnvelopeSchema>;
