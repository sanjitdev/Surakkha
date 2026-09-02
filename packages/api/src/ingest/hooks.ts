/**
 * Typed no-op hooks for steps 6–9 of the ingest driver.
 *
 * `setIngestHooks` is called once at boot by the downstream epic
 * that owns each hook. The handler in `frame.ts` never edits
 * `hooks.ts` — the iteration site is stable across epics.
 */

import { type BreachResult, EMPTY_BREACH_RESULTS } from "../rules/engine";

import type { ReadingFlag } from "@surakkha/shared";

export interface RuleEvaluationInput {
  readonly deviceId: string;
  readonly frame: {
    readonly version: 1;
    readonly device_id: string;
    readonly ts: number;
    readonly fw: string;
    readonly seq: number;
    readonly metrics: Record<string, number>;
  };
  /** Closed enum — unhandled flags surface as a compile error in the hook. */
  readonly flags: readonly ReadingFlag[];
}

export interface AlertEmissionInput {
  readonly deviceId: string;
  readonly ruleId: string;
  readonly severity: "info" | "warning" | "critical";
}

export interface StateMachineUpdateInput {
  readonly deviceId: string;
  readonly state: string;
  readonly previousState: string | null;
}

export interface AuditAppendInput {
  readonly auditAction:
    | "reading_ingested"
    | "reading_rate_limited"
    | "seq_drop_detected"
    | "seq_reorder_detected";
  readonly deviceId: string;
  readonly context?: Record<string, unknown>;
}

export interface IngestHooks {
  /** Rules engine returns the breach array; the no-op default returns
   *  the frozen empty tuple so the type is satisfied without allocating. */
  onRuleEvaluation(input: RuleEvaluationInput): Promise<readonly BreachResult[]>;
  onAlertEmission(input: AlertEmissionInput): Promise<void>;
  onStateMachineUpdate(input: StateMachineUpdateInput): Promise<void>;
  onAuditAppend(input: AuditAppendInput): Promise<void>;
}

const noopHooks: IngestHooks = {
  onRuleEvaluation: async () => EMPTY_BREACH_RESULTS,
  onAlertEmission: async () => undefined,
  onStateMachineUpdate: async () => undefined,
  onAuditAppend: async () => undefined,
};

/** Public reference to the no-op default — used at boot and in tests. */
export const NOOP_HOOKS: IngestHooks = noopHooks;

let currentHooks: IngestHooks = noopHooks;

/** Read the currently-installed hook set. */
export const getIngestHooks = (): IngestHooks => currentHooks;

/** Install a real hook set. Called once at boot — not concurrent-safe. */
export const setIngestHooks = (hooks: IngestHooks): void => {
  currentHooks = hooks;
};

/** Test-only: restore the no-op default. */
export const resetIngestHooks = (): void => {
  currentHooks = noopHooks;
};
