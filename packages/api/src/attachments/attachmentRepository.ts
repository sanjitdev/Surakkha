/**
 * `attachmentRepository.ts` — Story 4.13.
 *
 * Narrow Prisma slice for the `Attachment` table. Mirrors the
 * pattern from `incidentStateRepository.ts` (4.2) — every method is
 * a typed forwarder to Prisma, so production wiring is one
 * `attachment: { ... }` object and tests can stub any method.
 *
 * The interface is intentionally narrow: only the four methods the
 * `attachmentRouter` actually calls. The full Prisma `attachment`
 * delegate is NOT re-exported (a maintainer should add a method here
 * when adding a new route, NOT bypass this seam).
 */
/**
 * `attachmentRepository.ts` — Story 4.13.
 *
 * Narrow Prisma slice for the `Attachment` table. Mirrors the
 * pattern from `incidentStateRepository.ts` (4.2) — every method is
 * a typed forwarder to Prisma, so production wiring is one
 * `attachment: { ... }` object and tests can stub any method.
 *
 * The interface is intentionally narrow: only the four methods the
 * `attachmentRouter` actually calls. The full Prisma `attachment`
 * delegate is NOT re-exported (a maintainer should add a method here
 * when adding a new route, NOT bypass this seam).
 */

/**
 * The narrow row shape the api writes / reads. Matches Prisma's
 * `Attachment` model exactly. The adapter (`attachmentRowToPayload.ts`)
 * converts this to the wire shape (`AttachmentPayload`) — server-internal
 * columns never leak to the web.
 */
export interface AttachmentRow {
  readonly id: string;
  readonly incidentId: string;
  readonly url: string;
  readonly label: string | null;
  readonly mime: string | null;
  readonly uploadedByUserId: string | null;
  readonly createdAt: Date;
}

/**
 * The slice the writer needs from the real Prisma client. The four
 * methods cover the entire 4.13 surface; adding a fifth is a
 * deliberate step (e.g., a future pagination story would add
 * `findMany` with `take`).
 *
 * The `data` field on `create` is an inline shape (NOT
 * `Prisma.AttachmentUncheckedCreateInput`) to keep this module
 * decoupled from the Prisma type generator — the production
 * adapter narrows the real Prisma client via a structural cast.
 * Tests pass a stub with the same shape.
 */
export interface AttachmentRepository {
  readonly attachment: {
    create(args: {
      readonly data: {
        readonly incidentId: string;
        readonly url: string;
        readonly label?: string | null;
        readonly mime?: string | null;
        readonly uploadedByUserId?: string | null;
      };
    }): Promise<AttachmentRow>;
    findMany(args: {
      readonly where: { readonly incidentId: string };
      readonly orderBy?: { readonly createdAt: "asc" | "desc" };
    }): Promise<AttachmentRow[]>;
    findUnique(args: { readonly where: { readonly id: string } }): Promise<AttachmentRow | null>;
    delete(args: { readonly where: { readonly id: string } }): Promise<AttachmentRow>;
  };
}

/**
 * Adapter wiring: forward to the real Prisma client. Tests pass a stub
 * with the same shape.
 */
export const resolveAttachmentRepository = (prisma: {
  attachment: AttachmentRepository["attachment"];
}): AttachmentRepository =>
  // In production, `prisma` is the full Prisma client which has an
  // `attachment` delegate matching the slice's signature. The cast
  // here is a documentation seam — the interface intentionally
  // mirrors the Prisma shape so the production wiring is a thin
  // pass-through.
  ({ attachment: prisma.attachment });
