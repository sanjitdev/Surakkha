/** Pure adapter: server-side `AttachmentRow` → wire `AttachmentPayload`.
 *  Snake-cases the keys and ISO-encodes `createdAt` so server-internal
 *  columns never leak. */

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
  // `safeParse` (not `parse`) so a malformed payload surfaces as a
  // logged warning instead of crashing the response. Production rows
  // always have valid UUIDs (the Prisma column type); the drift
  // detection fires when the column shape changes underneath us.
  const parsed = AttachmentPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("attachmentRowToPayload: schema drift detected", parsed.error.issues);
  }
  return payload;
};
