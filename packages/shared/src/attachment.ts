/**
 * `attachment.ts` — wire-shape contracts for the attachment feature
 * (Story 4.13).
 *
 * Single source of truth for both the api's `attachmentRouter.ts`
 * and the web's `useAttachments.ts` — a structural drift surfaces
 * as a Zod parse failure at the fetch site.
 *
 * `mime` is `string | null` (when the caller omits the field and
 * the URL extension is unknown, the server stamps
 * `application/octet-stream`; the web renders the fallback badge).
 * `label` is also `string | null` (operator may omit it; the UI
 * renders the URL itself when label is null).
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
