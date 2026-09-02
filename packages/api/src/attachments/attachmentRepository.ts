/** Narrow Prisma slice for the `Attachment` table — four methods
 *  (`create` / `findMany` / `findUnique` / `delete`) shaped to match
 *  Prisma's `attachment` delegate so production wiring is a thin
 *  pass-through and tests stub the same shape. The full Prisma
 *  delegate is NOT re-exported. */

export interface AttachmentRow {
  readonly id: string;
  readonly incidentId: string;
  readonly url: string;
  readonly label: string | null;
  readonly mime: string | null;
  readonly uploadedByUserId: string | null;
  readonly createdAt: Date;
}

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

export const resolveAttachmentRepository = (prisma: {
  attachment: AttachmentRepository["attachment"];
}): AttachmentRepository => ({ attachment: prisma.attachment });
