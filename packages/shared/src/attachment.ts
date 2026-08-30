/**
 * `attachment.ts` — Story 4.13.
 *
 * Wire-shape contracts for the attachment feature:
 *
 *   - `AttachmentPayloadSchema` — the row shape the api returns and
 *     the web consumes.
 *   - `AttachmentListEnvelopeSchema` — the `{ attachments: [...] }`
 *     envelope the GET endpoint returns.
 *
 * These schemas are the single source of truth for both layers;
 * `attachmentRouter.ts` (api) and `useAttachments.ts` (web) consume
 * the SAME exports. A structural drift between the api's response
 * and the web's expectation surfaces as a Zod parse failure at the
 * fetch site.
 *
 * The `mime` field is `string | null` — the api's row stores the
 * value as nullable (Prisma `String?`); when the caller omits the
 * field and the URL extension is unknown, the server stamps
 * `application/octet-stream`. We expose the nullable shape so the
 * web can render the fallback badge ("unknown type").
 *
 * The `label` field is also `string | null` — the operator MAY
 * omit it; the UI renders the URL itself when the label is null.
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
