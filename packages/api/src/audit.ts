/**
 * Audit logger contract — Surakkha api (Story 1.5).
 *
 * One type definition, imported by the auth router (Story 1.4) and
 * the RBAC middleware (Story 1.5). Keeps the two surfaces in lockstep
 * without a circular import. The v1 implementation in `index.ts`
 * writes a structured log line; v2 (Story 5.6) writes to the database.
 */
import { type AuditAction } from "@surakkha/shared/rbac";

export interface AuditLogger {
  readonly emit: (event: {
    readonly auditAction: AuditAction;
    readonly userId?: string;
    readonly outcome: "success" | "failure";
    readonly context?: Record<string, unknown>;
  }) => void;
}