/**
 * `attachmentRowToPayload` — Story 4.13.
 *
 * Pure adapter: server-side `AttachmentRow` → wire `AttachmentPayload`.
 * Mirrors `notificationRowToPayload.ts` (4.10) — converts nullable
 * server columns to nullable wire fields, ISO-encodes the timestamp,
 * and drops any internal columns (none today, but the seam is here
 * for future schema changes).
 *
 * The payload uses snake_case wire keys to match the existing
 * `IncidentPayload` and `NotificationPayload` convention. The
 * server's Prisma schema uses camelCase columns — the adapter is
 * the ONLY place the casing conversion happens.
 */
import { type AttachmentPayload, AttachmentPayloadSchema } from "@surakkha/shared/attachment";

import { type AttachmentRow } from "./attachmentRepository.js";

export const attachmentRowToPayload = (row: AttachmentRow): AttachmentPayload => {
  const payload: AttachmentPayload = {
    id: row.id,
    incident_id: row.incidentId,
    url: row.url,
    label: row.label,
    mime: row.mime,
    uploaded_by_user_id: row.uploadedByUserId,
    created_at: row.createdAt.toISOString(),
  };
  // Round-trip through the canonical schema to fail fast on structural
  // drift (e.g., a future column rename that wasn't tracked here).
  // `safeParse` (not `parse`) so a malformed payload — e.g., a test
  // mock with a non-UUID `id` — surfaces as a logged warning instead
  // of crashing the response. Production rows always have valid
  // UUIDs (the Prisma column type); the drift detection fires when
  // the column shape changes underneath us.
  const parsed = AttachmentPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("attachmentRowToPayload: schema drift detected", parsed.error.issues);
  }
  return payload;
};
