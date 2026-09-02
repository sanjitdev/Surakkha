/**
 * Audit log wire types (Story 5.3).
 *
 * Read surface for `/api/audit/list`. The closed `AuditActionSchema`
 * enum lives in `rbac.ts` (the writer-side surface in Story 5.6 will
 * move it here). `payload` is intentionally `unknown` — audit rows
 * are heterogeneous by design.
 */
import { z } from "zod";

const ISO8601 = z.string().datetime({ offset: true });

/** Closed enumeration of resource types an `AuditLog` row may target.
 *  Kept separate from the Prisma `String` column so the wire surface
 *  has a closed shape while the DB stays write-flexible. */
export const AuditLogResourceSchema = z.enum([
  "Device",
  "Reading",
  "Alert",
  "Incident",
  "Rule",
  "User",
  "School",
  "Notification",
  "Simulator",
  "SeverityBanner",
  "Attachment",
  "Session",
  "Other",
]);
export type AuditLogResource = z.infer<typeof AuditLogResourceSchema>;

/** Wire row for an `AuditLog` entry. Read by `GET /api/audit/list`.
 *  `actorUserId` is nullable (FK is ON DELETE SET NULL; UI surfaces
 *  `null` as the literal string `"system"`). `resourceId` is nullable
 *  (actions like `logout` have no resource binding). `auditAction` is
 *  `z.string()` rather than the closed enum so a future writer-side
 *  action added before this read surface knows about it still renders
 *  in the admin UI. `payload` is `unknown` — see module preamble. */
export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  auditAction: z.string(),
  resource: z.string(),
  resourceId: z.string().nullable(),
  payload: z.unknown(),
  outcome: z.string(),
  createdAt: ISO8601,
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/** List envelope returned by `GET /api/audit/list`. Carries
 *  `total` + `truncated` so the page can render "showing 100 of
 *  250 events" copy when the table is full. */
export const AuditLogListEnvelopeSchema = z.object({
  rows: z.array(AuditLogEntrySchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type AuditLogListEnvelope = z.infer<typeof AuditLogListEnvelopeSchema>;

/** Wire shape of the admin list's filter query params. Both web
 *  and api import this type so the URL → query object contract
 *  has a single source of truth. */
export interface AuditLogFilters {
  readonly actorIds?: readonly string[];
  readonly event?: string;
  readonly resource?: AuditLogResource;
  readonly since?: string;
  readonly until?: string;
}
