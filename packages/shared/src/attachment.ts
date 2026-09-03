/**
 * Attachment wire-shape contracts.
 * `url` validates as an http(s) URL (the api re-checks via validateHttpUrl).
 * `mime` and `label` accept null: server stamps `application/octet-stream`
 * when unknown; UI renders the URL when label is omitted.
 */
import { z } from "zod";

export const AttachmentPayloadSchema = z.object({
  id: z.string().uuid(),
  incident_id: z.string().uuid(),
  url: z.string().url(),
  label: z.string().nullable(),
  mime: z.string().nullable(),
  uploaded_by_user_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type AttachmentPayload = z.infer<typeof AttachmentPayloadSchema>;

export const AttachmentListEnvelopeSchema = z.object({
  attachments: z.array(AttachmentPayloadSchema),
});
export type AttachmentListEnvelope = z.infer<typeof AttachmentListEnvelopeSchema>;
