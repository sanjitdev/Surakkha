/** Canonical error-code identifiers for the api wire contract. */
export const ERROR_CODES = {
  // ----- Generic (4xx / 5xx families) ------------------------------------
  INTERNAL_ERROR: { value: "internal_error" },
  NOT_FOUND: { value: "not_found" },
  VALIDATION_ERROR: { value: "validation_error" },
  FORBIDDEN: { value: "forbidden" },
  UNAUTHORIZED: { value: "unauthorized" },

  // ----- State-machine ----------------------------------------------------
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
  CONCURRENT_MODIFICATION: { value: "concurrent_modification" },
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]["value"];

export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.values(ERROR_CODES).map(
  (entry) => entry.value,
);
