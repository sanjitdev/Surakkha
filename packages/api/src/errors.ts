/**
 * Canonical error-code identifiers — single source of truth for the api.
 *
 * The 2026-08-31 api polish pass surfaced that the same dozen error-code
 * strings (e.g. `"internal_error"`, `"not_found"`, `"validation_error"`)
 * were repeated as bare string literals across 12+ routers. TypeScript
 * catches typos in the literal site (via the wire contract), but the
 * drift risk is real — a future contributor might write
 * `"interna_error"` in a new router and ESLint would not catch it
 * (the prose-linter misses it because it's a code-string, not prose).
 *
 * This module is the canonical home. Each code maps to:
 *   - The string literal the wire contract uses (the `.value`)
 *   - A TypeScript literal union (the `.type`) so typed sites can
 *     bind to the union rather than the string.
 *
 * Scope: api-internal only. The web package's transition-envelope
 * helpers import the typed `InvalidStateTransitionEnvelope` from
 * `@surakkha/shared/error-envelope`; this module is the api's source
 * of truth for the literals they consume.
 */

/**
 * `as const` so each entry is typed as its literal value, not a
 * `string` widening. Consumers can `import { ERROR_CODES } from
 * "./errors.js";` and reference `ERROR_CODES.NOT_FOUND.value`.
 */
export const ERROR_CODES = {
  // ----- Generic (4xx / 5xx families) ------------------------------------
  INTERNAL_ERROR: { value: "internal_error" },
  NOT_FOUND: { value: "not_found" },
  VALIDATION_ERROR: { value: "validation_error" },
  FORBIDDEN: { value: "forbidden" },
  UNAUTHORIZED: { value: "unauthorized" },

  // ----- State-machine ----------------------------------------------------
  // The 409 envelope on a typed state-machine miss. Carries optional
  // `from` / `attempted` / `reason` — see `@surakkha/shared/error-envelope`.
  INVALID_STATE_TRANSITION: { value: "invalid_state_transition" },
  INVALID_ASSIGNEE: { value: "invalid_assignee" },

  // ----- Auth -------------------------------------------------------------
  INVALID_CREDENTIALS: { value: "invalid_credentials" },
  INVALID_REFRESH: { value: "invalid_refresh" },

  // ----- Validation (router-specific) -------------------------------------
  INVALID_PAYLOAD: { value: "invalid_payload" },
  INVALID_RANGE: { value: "invalid_range" },
  INVALID_DEVICE_ID: { value: "invalid_device_id" },
  INVALID_IDEMPOTENCY_KEY: { value: "invalid_idempotency_key" },
  INVALID_SCENARIO: { value: "invalid_scenario" },

  // ----- Simulator admin --------------------------------------------------
  SECRET_MISMATCH: { value: "secret_mismatch" },
  SIMULATOR_UNREACHABLE: { value: "simulator_unreachable" },
  SWITCH_IN_PROGRESS: { value: "switch_in_progress" },

  // ----- Alerts ingest ----------------------------------------------------
  SCHEMA_DRIFT: { value: "schema_drift" },

  // ----- Reason payloads for INVALID_STATE_TRANSITION --------------------
  // Lives here rather than in the envelope schema so the api and the
  // web's envelope-parser can share the vocabulary without a runtime
  // import. The web reads these as plain strings via Zod (`z.string().optional()`).
  CONCURRENT_MODIFICATION: { value: "concurrent_modification" },
} as const;

/**
 * Convenience union of all canonical error-code string literals.
 * Use this when a function returns `{ error: "..." }` so the type
 * checker narrows the discriminant for callers.
 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]["value"];

/**
 * The full set of `ErrorCode` values, as an array. Use this in tests
 * to assert every error envelope returned by an api route belongs to
 * the canonical vocabulary.
 */
export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.values(ERROR_CODES).map(
  (entry) => entry.value,
);
