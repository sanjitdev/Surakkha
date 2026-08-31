/**
 * `transitionEnvelope.ts` — closes web-side P1 #3 (api critique).
 *
 * Reads the canonical 409 envelope from
 * `@surakkha/shared/error-envelope`'s
 * `InvalidStateTransitionEnvelopeSchema` and produces operator-
 * facing toast copy that names the actual reason — typed state-
 * machine miss vs concurrent modification vs the per-verb fallback
 * ("Already acknowledged", etc).
 *
 * Replaces the previous per-verb hardcoded 409 copy in
 * `useAcknowledgeMutation` / `useAssignMutation` /
 * `useSubmitResultMutation` / `useReopenMutation`. The previous
 * shape always said `"Already acknowledged"` regardless of WHY the
 * 409 landed — operators couldn't tell whether the incident was
 * already in a post-transition state, whether another operator
 * beat them to it, or whether the api's typed state machine
 * rejected the transition outright (e.g. trying to acknowledge a
 * RESOLVED incident).
 *
 * Why a pure helper (no React, no fetch): the discriminator
 * reads from an already-parsed envelope, runs in a single
 * expression, and is unit-testable without `render()`.
 */
import {
  type InvalidStateTransitionEnvelope,
  InvalidStateTransitionEnvelopeSchema,
} from "@surakkha/shared/error-envelope";
import { type IncidentState } from "@surakkha/shared/incident";

/**
 * The 5 transition verbs — mirrors the api's `ActionVerbSchema`
 * at `packages/shared/src/incident.ts` (snake_case). The web
 * client's `ActionSlot` enum uses kebab-case
 * (`"submit-result"`) for the UI; the helper maps to snake_case
 * internally because that's what the api's typed state machine
 * emits in the envelope's `attempted` field.
 */
export type TransitionVerb = "acknowledge" | "assign" | "submit_result" | "resolve" | "reopen";

/**
 * Parse a 409 response body via the shared Zod schema. Returns
 * `null` on a non-envelope shape — the api never emits one, but
 * a future schema bump or a buggy proxy could; the caller falls
 * back to the per-verb generic message.
 */
export const parseTransitionEnvelope = (body: unknown): InvalidStateTransitionEnvelope | null => {
  const parsed = InvalidStateTransitionEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

/**
 * Concurrency message — server told us another writer beat us to
 * the row (OptimisticConcurrencyError or P2002 partial-unique-
 * index race at the api side). Same copy for every verb because
 * the operator's recovery action is identical: refresh the row
 * and retry.
 */
const CONCURRENCY_MESSAGE = "Modified by another operator — refresh and retry";

/**
 * Per-state human label — used by the typed-miss branch to
 * produce "Cannot acknowledge a {label} incident". Kept
 * lowercase so the template sentence reads as the rest of the
 * banner copy does.
 */
const STATE_HUMAN: Readonly<Record<IncidentState, string>> = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  INSPECTING: "in-progress",
  SAFE: "safe",
  UNSAFE: "unsafe",
  MONITORING: "monitoring",
  RESOLVED: "resolved",
  REOPENED: "reopened",
};

/**
 * Per-verb present participle — used inside
 * `"Cannot ${verbLabel} a ${stateLabel} incident"`. `submit_result`
 * uses "submit a result for" (longer verb form) to keep the
 * sentence grammatical; the others use the bare verb.
 */
const VERB_PRESENT: Readonly<Record<TransitionVerb, string>> = {
  acknowledge: "acknowledge",
  assign: "assign",
  submit_result: "submit a result for",
  resolve: "resolve",
  reopen: "reopen",
};

/**
 * Per-verb fallback — used when the envelope's `from` and
 * `attempted` are both absent AND `reason` is absent (a future
 * 409 reason we haven't shipped a typed branch for). Mirrors
 * the previous hardcoded per-verb copy so existing user
 * expectations don't regress.
 */
const VERB_GENERIC_FALLBACK: Readonly<Record<TransitionVerb, string>> = {
  acknowledge: "Already acknowledged",
  assign: "Already assigned",
  submit_result: "Already submitted",
  resolve: "Already resolved",
  reopen: "Cannot reopen — incident is not RESOLVED",
};

/**
 * Map a `(verb, envelope)` pair to the operator-facing copy.
 *
 * Three branches in priority order:
 *
 *   1. `reason === "concurrent_modification"` → concurrency
 *      message (the api's `transitionHelpers.ts:545/558` paths).
 *   2. `from` + `attempted` both present → typed state-machine
 *      miss (the api's `transitionHelpers.ts:498` path). The
 *      message names the current state so the operator knows
 *      what they were trying to do.
 *   3. neither → per-verb fallback (defensive; should never hit
 *      because the api's `respondInvalidStateTransition` always
 *      emits one of the two structured fields).
 */
export const invalidTransitionMessage = (
  verb: TransitionVerb,
  envelope: InvalidStateTransitionEnvelope,
): string => {
  if (envelope.reason === "concurrent_modification") {
    return CONCURRENCY_MESSAGE;
  }
  if (envelope.from !== undefined && envelope.attempted !== undefined) {
    // `envelope.from` is typed `string | undefined` at the wire
    // boundary (the schema uses `z.string().optional()` — the wire
    // doesn't carry the IncidentState enum). The map keys are the
    // narrow enum, so we narrow with `Object.prototype.hasOwnProperty`
    // before indexing. An unknown state falls through to the
    // `?? envelope.from` branch (covered by the FUTURE_STATE spec
    // case in `transitionEnvelope.spec.ts`).
    const fromKey = envelope.from as IncidentState;
    const fromLabel = Object.prototype.hasOwnProperty.call(STATE_HUMAN, fromKey)
      ? STATE_HUMAN[fromKey]
      : envelope.from;
    const verbLabel = VERB_PRESENT[verb];
    // English article agreement: "a" before a consonant, "an"
    // before a vowel. Operates on the label's first character.
    // Hyphenated labels (e.g. "in-progress") use the first
    // letter; multi-word labels would use the first character.
    const article = /^[aeiou]/i.test(fromLabel) ? "an" : "a";
    return `Cannot ${verbLabel} ${article} ${fromLabel} incident`;
  }
  return VERB_GENERIC_FALLBACK[verb];
};
