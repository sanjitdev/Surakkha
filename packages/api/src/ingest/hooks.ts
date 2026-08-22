/**
 * Ingest hooks — Story 2.2 (ADR 0013, architecture §3.2 steps 6–9).
 *
 * The 10-step driver iterates `PROCESSING_ORDER` and, for steps 6
 * (rule evaluation), 7 (alert emission), 8 (state-machine update),
 * and 9 (audit append), calls a typed no-op hook. v1 ships the
 * no-op default; Epic 3 (rules), Epic 4 (alerts / state), and
 * Epic 5 (audit pipeline) call `setIngestHooks(...)` once at their
 * boot path to wire the real implementation. The handler never
 * edits `frame.ts` — the iteration site is stable across epics.
 *
 * Why typed narrow interfaces (not `unknown`): the hook call sites
 * must be type-checked against the future epic's contract, so a
 * re-shape in Epic 3 surfaces here, not as a silent `any` slipped
 * through the iteration.
 */

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
  /**
   * Closed enum per `ReadingFlagSchema` (Story 2.3). Tightened from
   * `readonly string[]` so a hook implementation that does not handle
   * the closed enum surfaces at compile time, not at runtime.
   */
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
  onRuleEvaluation(input: RuleEvaluationInput): Promise<void>;
  onAlertEmission(input: AlertEmissionInput): Promise<void>;
  onStateMachineUpdate(input: StateMachineUpdateInput): Promise<void>;
  onAuditAppend(input: AuditAppendInput): Promise<void>;
}

const noopHooks: IngestHooks = {
  onRuleEvaluation: async () => undefined,
  onAlertEmission: async () => undefined,
  onStateMachineUpdate: async () => undefined,
  onAuditAppend: async () => undefined,
};

let currentHooks: IngestHooks = noopHooks;

/** Read the currently-installed hook set. */
export const getIngestHooks = (): IngestHooks => currentHooks;

/**
 * Install a real hook set. Called by Epic 3/4/5 boot code. Not
 * concurrent-safe; the call site is responsible for setting it once
 * before any frame is processed.
 */
export const setIngestHooks = (hooks: IngestHooks): void => {
  currentHooks = hooks;
};

/** Test-only: restore the no-op default. */
export const resetIngestHooks = (): void => {
  currentHooks = noopHooks;
};