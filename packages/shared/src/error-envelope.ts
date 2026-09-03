/**
 * Canonical HTTP error envelopes shared across api + web.
 * Two flavors merge into one schema via optional fields:
 *   - typed state-machine miss:  `{ error, from, attempted }`
 *   - DB-layer concurrency:      `{ error, reason: "concurrent_modification" }`
 * Clients discriminate on which optional fields are present; the
 * `error` discriminator is always `"invalid_state_transition"`.
 */
import { z } from "zod";

export const InvalidStateTransitionEnvelopeSchema = z.object({
  error: z.literal("invalid_state_transition"),
  from: z.string().optional(),
  attempted: z.string().optional(),
  reason: z.string().optional(),
});
export type InvalidStateTransitionEnvelope = z.infer<typeof InvalidStateTransitionEnvelopeSchema>;
