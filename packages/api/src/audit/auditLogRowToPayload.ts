/**
 * Pure adapter from a Prisma `AuditLog` row to the wire
 * `AuditLogEntry` shape (defined in `@surakkha/shared/audit`).
 * Lives in a separate module so the data slice and the wire
 * adapter are independently testable.
 */
import { type AuditLogEntry } from "@surakkha/shared/audit";
import { AuditActionSchema } from "@surakkha/shared/rbac";

import { type AuditLogRow } from "./auditLogRepository.js";

/**
 * `payload` is forwarded verbatim as `unknown` (audit payloads are
 * heterogeneous by design). `auditAction` is a free `String` in
 * the DB but the wire narrows it to the closed `AuditActionSchema`
 * enum; unknown values fall through as the raw row value so the
 * row still renders in the admin UI if the closed enum drifts.
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
      // Malformed date string — preserve the original so the row
      // still renders in the admin UI.
      ({ createdAt } = row);
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
