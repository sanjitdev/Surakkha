/**
 * `auditLogRowToPayload.ts` — Story 5.3.
 *
 * Pure adapter from a Prisma `AuditLog` row to the wire
 * `AuditLogEntry` shape (defined in `@surakkha/shared/audit`).
 * Mirrors the `notificationRowToPayload` / `incidentRowToPayload`
 * pattern: a separate module from the repository so the data
 * slice and the wire adapter are independently testable.
 *
 * Why a separate module (vs living inside `auditLogRepository.ts`):
 *
 *   - The adapter is a PURE HELPER with no IO and no Prisma
 *     dependency at runtime — it could be invoked from any layer
 *     that holds an `AuditLogRow`. Splitting it out keeps the
 *     repository module's surface narrow (the data slice only)
 *     while this module owns the wire shape.
 *
 *   - Mirrors the convention set by `notificationRowToPayload.ts`
 *     (Story 4.10) and `incidentRowToPayload` (Story 4.2) —
 *     a maintainer adding a new audit row adapter knows to look
 *     in this sibling module.
 *
 * The audit writer (Story 5.6) writes the same shape via the
 * existing `audit.emit(...)` contract. This adapter is the
 * read-side companion that turns a DB row into a wire entry.
 */
import { type AuditLogEntry } from "@surakkha/shared/audit";
import { AuditActionSchema } from "@surakkha/shared/rbac";

import { type AuditLogRow } from "./auditLogRepository.js";

/**
 * Build the wire-row `AuditLogEntry` from a Prisma `AuditLog` row.
 *
 * `payload` is forwarded verbatim as `unknown` (the spec design
 * note "Why payload Json and not a typed Prisma model" calls out
 * that audit payloads are heterogeneous by design). The schema
 * permits `z.unknown()`; the UI renders it as JSON.
 *
 * `auditAction` is a free `String` in the DB but the wire
 * narrows it to the closed `AuditActionSchema` enum. Unknown
 * values (e.g., a future enum member added in 5.6) fall through
 * as a defensive string — `safeParse` returns the raw
 * `row.auditAction` so the row still renders in the admin UI
 * even if the closed enum drifts. The wire schema's
 * `z.string()` accepts both closed-enum values and unknown
 * strings.
 */
export const auditLogRowToPayload = (row: AuditLogRow): AuditLogEntry => {
  const parsedAction = AuditActionSchema.safeParse(row.auditAction);
  const auditAction: string = parsedAction.success ? parsedAction.data : row.auditAction;
  let createdAt: string;
  if (row.createdAt instanceof Date) {
    createdAt = row.createdAt.toISOString();
  } else if (typeof row.createdAt === "string") {
    try {
      createdAt = new Date(row.createdAt).toISOString();
    } catch {
      // Malformed date string — fall through with the raw value.
      // The wire schema's `ISO8601` would reject this, but at
      // this layer the safest is to preserve the original so the
      // row still renders in the admin UI.
      const raw = row.createdAt;
      createdAt = raw;
    }
  } else {
    createdAt = String(row.createdAt);
  }
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    auditAction,
    resource: row.resource,
    resourceId: row.resourceId,
    payload: row.payload,
    outcome: row.outcome,
    createdAt,
  };
};
