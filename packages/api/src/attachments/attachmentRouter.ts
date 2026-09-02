/**
 * `attachmentRouter.ts` — three routes on `/api/incidents/:id/attachments`:
 *   POST   /api/incidents/:id/attachments — create (URL + label + optional mime)
 *   GET    /api/incidents/:id/attachments — list (reverse-chronological)
 *   DELETE /api/attachments/:id           — delete (uploader OR Admin)
 *
 * RBAC: matrix grants per resource. `validateHttpUrl` from
 * `@surakkha/shared/urlValidation` is the security boundary that
 * rejects `javascript:` / `data:` / `file:` / `vbscript:` / relative
 * paths. Attachments are NOT state transitions (no socket emit).
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";
import { detectMimeFromURL, FALLBACK_MIME } from "@surakkha/shared/mimeAutoDetect";
import { idPathSchema } from "@surakkha/shared/schemas";
import { InvalidUrlError, validateHttpUrl } from "@surakkha/shared/urlValidation";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_INTERNAL_ERROR,
  HTTP_NO_CONTENT,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from "../httpStatus.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import { type AttachmentRepository, type AttachmentRow } from "./attachmentRepository.js";
import { attachmentRowToPayload } from "./attachmentRowToPayload.js";

const MIME_OVERRIDE_REGEX = /^[a-z]+\/[a-z0-9.+-]+$/i;

const createBodySchema = z.object({
  url: z.string().min(1, "url is required"),
  label: z.string().max(200, "label must be at most 200 characters").nullable().optional(),
  mime: z
    .string()
    .regex(MIME_OVERRIDE_REGEX, "mime must be in `type/subtype` format")
    .nullable()
    .optional(),
});

export interface AttachmentRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: AttachmentRepository;
  /** Narrow read-side slice for the Tech-ownership check (a
   *  Technician can only POST/GET on incidents they're assigned
   *  to). The injection keeps the attachment router decoupled
   *  from the full incident state machine. */
  readonly incidentFindUnique: (args: {
    readonly where: { readonly id: string };
  }) => Promise<{ readonly assigneeUserId: string | null } | null>;
}

const validateUrlOrRespond = (res: Response, url: string): Response | null => {
  try {
    validateHttpUrl(url);
  } catch (err) {
    const message =
      err instanceof InvalidUrlError ? err.message : "URL must be http:// or https://";
    return res.status(HTTP_BAD_REQUEST).json({
      error: ERROR_CODES.INVALID_PAYLOAD.value,
      issues: [{ path: ["url"], message }],
    });
  }
  return null;
};

export const buildAttachmentRouter = (deps: AttachmentRouterDeps): Router => {
  const router = express.Router();

  // Admin bypass; original uploader can delete their own attachment;
  // a different Operator/Technician gets 403.
  const enforceDeleteOwnership = (
    req: AuthorizedRequest,
    res: Response,
    row: AttachmentRow,
  ): Response | null => {
    if (req.user?.role === "Admin") return null;
    if (req.user?.id === row.uploadedByUserId) return null;
    deps.audit.emit({
      auditAction: "rbac_denied",
      userId: req.user?.id,
      outcome: "failure",
      context: {
        subject: req.user?.role ?? "Unknown",
        action: "delete",
        resource: "Attachment",
        reason: "not_uploader",
      },
    });
    return res.status(HTTP_FORBIDDEN).json({
      error: ERROR_CODES.FORBIDDEN.value,
      required_role: "Admin",
    });
  };

  // Tech-ownership: a Technician can only POST/GET on incidents
  // they're assigned to. Admin / Operator / Viewer skip.
  const enforceTechOwnership = async (
    req: AuthorizedRequest,
    res: Response,
    incidentId: string,
  ): Promise<Response | null> => {
    if (req.user?.role !== "Technician") return null;
    let incident: { assigneeUserId: string | null } | null;
    try {
      incident = await deps.incidentFindUnique({ where: { id: incidentId } });
    } catch (err) {
      console.error("api/attachments: incidentFindUnique failed", err);
      return res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    }
    if (incident === null) {
      return res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
    }
    if (incident.assigneeUserId !== req.user.id) {
      deps.audit.emit({
        auditAction: "rbac_denied",
        userId: req.user.id,
        outcome: "failure",
        context: {
          subject: req.user.role,
          action: "create",
          resource: "Attachment",
          reason: "not_assignee",
        },
      });
      return res.status(HTTP_FORBIDDEN).json({
        error: ERROR_CODES.FORBIDDEN.value,
        required_role: "Technician",
      });
    }
    return null;
  };

  const createAttachmentRowOrRespond = async (args: {
    readonly req: AuthorizedRequest;
    readonly res: Response;
    readonly incidentId: string;
    readonly body: z.infer<typeof createBodySchema>;
    readonly mime: string;
  }): Promise<Response | null> => {
    const { req, res, incidentId, body, mime } = args;
    try {
      const row = await deps.repo.attachment.create({
        data: {
          incidentId,
          url: body.url,
          label: body.label ?? null,
          mime,
          uploadedByUserId: req.user?.id ?? null,
        },
      });
      const payload: AttachmentPayload = attachmentRowToPayload(row);
      res.status(HTTP_CREATED).json(payload);
      return null;
    } catch (err) {
      console.error("api/attachments: create failed", err);
      return res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    }
  };

  router.post(
    "/api/incidents/:id/attachments",
    authorize({ action: "create", resource: "Attachment" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.VALIDATION_ERROR.value,
          issues: idParsed.error.issues,
        });
        return;
      }
      const { id } = idParsed.data;
      const bodyParsed = createBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.INVALID_PAYLOAD.value,
          issues: bodyParsed.error.issues,
        });
        return;
      }
      const urlDenied = validateUrlOrRespond(res, bodyParsed.data.url);
      if (urlDenied !== null) return;
      const ownershipDenied = await enforceTechOwnership(req, res, id);
      if (ownershipDenied !== null) return;
      // MIME: explicit override wins; otherwise auto-detect from
      // the URL extension; otherwise fall back to the binary-stream
      // default.
      const mime = bodyParsed.data.mime ?? detectMimeFromURL(bodyParsed.data.url) ?? FALLBACK_MIME;
      await createAttachmentRowOrRespond({
        req,
        res,
        incidentId: id,
        body: bodyParsed.data,
        mime,
      });
    },
  );

  router.get(
    "/api/incidents/:id/attachments",
    authorize({ action: "read", resource: "Attachment" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.VALIDATION_ERROR.value,
          issues: idParsed.error.issues,
        });
        return;
      }
      const { id } = idParsed.data;
      const ownershipDenied = await enforceTechOwnership(req, res, id);
      if (ownershipDenied !== null) return;
      let rows: AttachmentRow[];
      try {
        rows = await deps.repo.attachment.findMany({
          where: { incidentId: id },
          orderBy: { createdAt: "desc" },
        });
      } catch (err) {
        console.error("api/attachments: findMany failed", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      const body = {
        attachments: rows.map((r) => attachmentRowToPayload(r)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  router.delete(
    "/api/attachments/:id",
    authorize({ action: "delete", resource: "Attachment" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: ERROR_CODES.VALIDATION_ERROR.value,
          issues: idParsed.error.issues,
        });
        return;
      }
      const { id } = idParsed.data;
      let row: AttachmentRow | null;
      try {
        row = await deps.repo.attachment.findUnique({ where: { id } });
      } catch (err) {
        console.error("api/attachments: findUnique failed", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      if (row === null) {
        res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
        return;
      }
      const ownershipDenied = enforceDeleteOwnership(req, res, row);
      if (ownershipDenied !== null) return;
      try {
        await deps.repo.attachment.delete({ where: { id } });
      } catch (err) {
        console.error("api/attachments: delete failed", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      res.status(HTTP_NO_CONTENT).send();
    },
  );

  return router;
};
