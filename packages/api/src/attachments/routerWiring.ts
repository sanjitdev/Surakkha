/**
 * `routerWiring.ts` — Story 4.13.
 *
 * Lazily-resolves the production `AttachmentRepository` and
 * wraps `buildAttachmentRouter` so the api can boot without
 * `DATABASE_URL` set (mirrors `notifications/routerWiring.ts`
 * for 4.10).
 *
 * Why a separate file:
 *   - `src/index.ts` is already near the `max-lines: 500` ESLint
 *     ceiling (the notifications mount pushed it to ~830 lines
 *     before extraction). Adding the attachment mount inline
 *     would push it past the ceiling.
 *   - The lazy resolver pattern (`ensureRepo` + cached handle)
 *     keeps the boot order independent of when Prisma migrations
 *     run (mirrors the 4.10 / 4.2 pattern).
 *
 * The router also needs `incidentFindUnique` — a narrow seam
 * over the Prisma `incident` delegate so the per-route
 * Tech-ownership helper can read the row's `assigneeUserId`
 * without leaking the full incident delegate. The wrapper
 * resolves the same Prisma singleton on first request.
 */
import { type Router } from "express";

import { type AuditLogger } from "../audit.js";

import { type AttachmentRepository, resolveAttachmentRepository } from "./attachmentRepository.js";
import { buildAttachmentRouter } from "./attachmentRouter.js";

export const mountAttachmentRouter = (args: {
  readonly app: { readonly use: (handler: Router) => void };
  readonly audit: AuditLogger;
  readonly resolvePrismaClient: () => Promise<unknown>;
}): Router => {
  const { app, audit, resolvePrismaClient } = args;

  let cachedRepo: AttachmentRepository | null = null;
  let cachedIncidentFindUnique:
    | ((args: { readonly where: { readonly id: string } }) => Promise<{
        readonly assigneeUserId: string | null;
      } | null>)
    | null = null;

  const ensureRepo = async (): Promise<AttachmentRepository> => {
    if (cachedRepo === null) {
      const client = await resolvePrismaClient();
      cachedRepo = resolveAttachmentRepository(
        client as Parameters<typeof resolveAttachmentRepository>[0],
      );
    }
    return cachedRepo;
  };

  const ensureIncidentFindUnique = async (): Promise<
    (args: { readonly where: { readonly id: string } }) => Promise<{
      readonly assigneeUserId: string | null;
    } | null>
  > => {
    if (cachedIncidentFindUnique === null) {
      const client = (await resolvePrismaClient()) as {
        readonly incident: {
          findUnique(args: {
            readonly where: { readonly id: string };
            readonly select?: { readonly assigneeUserId: true };
          }): Promise<{ readonly assigneeUserId: string | null } | null>;
        };
      };
      cachedIncidentFindUnique = async (findArgs) => {
        try {
          const row = await client.incident.findUnique({
            where: findArgs.where,
            select: { assigneeUserId: true },
          });
          return row;
        } catch {
          // The router's per-handler catch surfaces 500 on the
          // thrown error; we re-throw the original to preserve
          // the stack. A swallowed error would mask a DB outage.
          throw new Error("incidentFindUnique failed");
        }
      };
    }
    return cachedIncidentFindUnique;
  };

  const router = buildAttachmentRouter({
    audit,
    repo: {
      attachment: {
        create: async (createArgs) => {
          const repo = await ensureRepo();
          return repo.attachment.create(createArgs);
        },
        findMany: async (findManyArgs) => {
          const repo = await ensureRepo();
          return repo.attachment.findMany(findManyArgs);
        },
        findUnique: async (findUniqueArgs) => {
          const repo = await ensureRepo();
          return repo.attachment.findUnique(findUniqueArgs);
        },
        delete: async (deleteArgs) => {
          const repo = await ensureRepo();
          return repo.attachment.delete(deleteArgs);
        },
      },
    },
    incidentFindUnique: async (findArgs) => ensureIncidentFindUnique().then((fn) => fn(findArgs)),
  });
  app.use(router);
  return router;
};
