/**
 * `audit.ts` — Story 5.3.
 *
 * Wire types for the Admin Audit Log read surface. Mirrors the
 * `notification.ts:8-27` preamble pattern: a dedicated sibling
 * per read surface so cross-cutting imports don't couple the
 * Incident / Notification / Audit modules' RBAC + test rigs.
 *
 * Why a dedicated module (vs adding to `notification.ts` or
 * `rbac.ts`):
 *
 *   - `notification.ts` is the notification surface (row shape
 *     `{ id, severity, incidentId, ... }`). The audit row carries
 *     a different shape (`{ auditAction, resource, resourceId,
 *     payload, outcome }`) and would muddle the notification
 *     wire envelope.
 *
 *   - `rbac.ts` houses the closed `AuditActionSchema` enum (24
 *     values), which this story leaves in place. Re-exporting
 *     `AuditAction` from this module would create two canonical
 *     homes — Story 5.6's writer-swap will move the enum into
 *     here (per spec Boundaries & Constraints).
 *
 *   - The read surface is independent of the writer. Story 5.3
 *     ships the read surface; Story 5.6 swaps the writer. The
 *     schemas in this module describe the READ wire; the writer
 *     only depends on the closed `AuditActionSchema` enum.
 *
 * The `payload` column is intentionally `unknown` here — the
 * spec design note "Why payload Json and not a typed Prisma
 * model" calls this out (audit payloads are heterogeneous by
 * design; `csv_exported` carries `{rowCount, since, until,
 * truncated}`, `incident_state_changed` carries `{from, to,
 * actorRole}`).
 */
import { z } from "zod";

const ISO8601 = z.string().datetime({ offset: true });

/**
 * Closed enumeration of resource types an `AuditLog` row may
 * target. Sourced from the existing `audit.emit` call sites
 * across the codebase — the enum is closed today but the writer
 * is free to add new resources without a Zod migration (the
 * router coerces unknown values into `"Other"` for the
 * filter chip and otherwise passes them through verbatim).
 *
 * Kept separate from the Prisma `String` column (which is
 * intentionally NOT a Prisma enum per the spec design note)
 * so the wire surface has a closed shape while the DB stays
 * write-flexible.
 */
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

/**
 * The wire row for an `AuditLog` entry. Read by
 * `GET /api/audit/list` (Story 5.3) and consumed by the
 * `/audit` admin page. Field order matches the Prisma
 * `AuditLog` model + the read-only `payload` projection.
 *
 * `actorUserId` is nullable — the FK is ON DELETE SET NULL so
 * a deleted actor's audit rows survive (the spec design note
 * "Why actorUserId is nullable"). The UI surfaces `null` as the
 * literal string `"system"`.
 *
 * `resourceId` is nullable — actions like `logout` have no
 * resource binding. The UI renders a dash (no click-through)
 * when this is null.
 *
 * `auditAction` is `z.string()` rather than the closed
 * `AuditActionSchema` enum — the writer (Story 5.6) is the
 * canonical emitter, and a future action added before this
 * read surface knows about it must still render in the admin
 * UI. The adapter falls through to the raw string on a
 * closed-enum miss; the wire schema accepts both known enum
 * values and drift strings.
 *
 * `payload` is intentionally `unknown` — see module preamble.
 * The UI surfaces it as a JSON `<pre>` block; the schema-level
 * `z.unknown()` validates the value is JSON-deserialisable.
 */
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

/**
 * The list envelope returned by `GET /api/audit/list`. Mirrors
 * the Story 5.1 `AdminNotificationListEnvelopeSchema` shape with
 * the row type swapped for `AuditLogEntry`. Carries `total` +
 * `truncated` so the page can render "showing 100 of 250 events"
 * copy when the table is full.
 */
export const AuditLogListEnvelopeSchema = z.object({
  rows: z.array(AuditLogEntrySchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type AuditLogListEnvelope = z.infer<typeof AuditLogListEnvelopeSchema>;

/**
 * The wire shape of the admin list's filter query params. Both
 * web and api import this type so the URL → query object contract
 * has a single source of truth.
 *
 * - `actorIds` is a multi-select (CSV-repeated `?actorIds=`).
 * - `event` is a free-text substring filter (case-insensitive on
 *   `auditAction`).
 * - `resource` is a closed-enum chip; the api de-duplicates +
 *   coerces unknown values to 400.
 * - `since` / `until` are ISO 8601 datetimes (inclusive lower /
 *   exclusive upper bounds; Prisma `gte` / `lt`).
 */
export interface AuditLogFilters {
  readonly actorIds?: readonly string[];
  readonly event?: string;
  readonly resource?: AuditLogResource;
  readonly since?: string;
  readonly until?: string;
}
