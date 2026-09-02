/**
 * Pure helper that maps the canonical 409
 * `InvalidStateTransitionEnvelope` to operator-facing toast
 * copy. Three branches in priority order: concurrent
 * modification, typed state-machine miss (names the current
 * state), per-verb fallback.
 */
import {
  type InvalidStateTransitionEnvelope,
  InvalidStateTransitionEnvelopeSchema,
} from "@surakkha/shared/error-envelope";
import { type IncidentState } from "@surakkha/shared/incident";

/**
 * The 5 transition verbs — snake_case matches the api's
 * `ActionVerbSchema` (the web `ActionSlot` enum is kebab-case
 * for the UI but the envelope's `attempted` field is snake_case).
 */
export type TransitionVerb = "acknowledge" | "assign" | "submit_result" | "resolve" | "reopen";

export const parseTransitionEnvelope = (body: unknown): InvalidStateTransitionEnvelope | null => {
  const parsed = InvalidStateTransitionEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

const CONCURRENCY_MESSAGE = "Modified by another operator — refresh and retry";

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

const VERB_PRESENT: Readonly<Record<TransitionVerb, string>> = {
  acknowledge: "acknowledge",
  assign: "assign",
  submit_result: "submit a result for",
  resolve: "resolve",
  reopen: "reopen",
};

const VERB_GENERIC_FALLBACK: Readonly<Record<TransitionVerb, string>> = {
  acknowledge: "Already acknowledged",
  assign: "Already assigned",
  submit_result: "Already submitted",
  resolve: "Already resolved",
  reopen: "Cannot reopen — incident is not RESOLVED",
};

export const invalidTransitionMessage = (
  verb: TransitionVerb,
  envelope: InvalidStateTransitionEnvelope,
): string => {
  if (envelope.reason === "concurrent_modification") {
    return CONCURRENCY_MESSAGE;
  }
  if (envelope.from !== undefined && envelope.attempted !== undefined) {
    // `envelope.from` is typed `string | undefined` at the wire
    // boundary (`z.string().optional()`); narrow with
    // `Object.prototype.hasOwnProperty` before indexing.
    const fromKey = envelope.from as IncidentState;
    const fromLabel = Object.prototype.hasOwnProperty.call(STATE_HUMAN, fromKey)
      ? STATE_HUMAN[fromKey]
      : envelope.from;
    const verbLabel = VERB_PRESENT[verb];
    // Article agreement: "a" before a consonant, "an" before a vowel.
    const article = /^[aeiou]/i.test(fromLabel) ? "an" : "a";
    return `Cannot ${verbLabel} ${article} ${fromLabel} incident`;
  }
  return VERB_GENERIC_FALLBACK[verb];
};
