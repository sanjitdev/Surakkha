/** Audit logger contract — shared by auth router and RBAC middleware. */
import { type AuditAction } from "@surakkha/shared/rbac";

export interface AuditLogger {
  readonly emit: (event: {
    readonly auditAction: AuditAction;
    readonly userId?: string;
    /**
     * `outcome` is intentionally a three-state semantic:
     *   - `"success"` — the audit action completed normally
     *     (e.g. `login_success`, `incident_state_changed`).
     *   - `"failure"` — the audit action was rejected (e.g.
     *     `login_failure`, `rbac_denied`).
     *   - `"allow"` — the audit action is a *permit* report on a
     *     gate that COULD have rejected (e.g. `rbac_allowed`).
     *     Distinct from `"success"` because an allow is not an
     *     achievement — it is a log-only signal to dashboards that
     *     key off permitted-vs-denied counts. The `"success"` value
     *     remains reserved for actions whose `outcome` is
     *     semantically meaningful to the reader.
     */
    readonly outcome: "success" | "failure" | "allow";
    readonly context?: Record<string, unknown>;
  }) => void;
}
