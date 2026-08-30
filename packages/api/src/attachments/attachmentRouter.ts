/**
 * `attachmentRouter.ts` — Story 4.13.
 *
 * Three routes:
 *
 *   POST   /api/incidents/:id/attachments — create (URL + label + optional mime)
 *   GET    /api/incidents/:id/attachments — list (reverse-chronological)
 *   DELETE /api/attachments/:id           — delete (uploader OR Admin)
 *
 * RBAC per the matrix (`packages/shared/src/rbac.ts`):
 *   - create:  Admin, Operator, Technician (NOT Viewer)
 *   - read:    all four roles
 *   - delete:  Admin (matrix-level); per-row "uploader can delete own"
 *              is enforced in the DELETE handler
 *
 * Tech-ownership (4.4 / 4.6 pattern): a Technician can only POST/GET
 * attachments on incidents they're assigned to. The check fires
 * AFTER the matrix-level RBAC passes (matrix grants the cell; the
 * handler narrows by row).
 *
 * SECURITY (URL validation): `validateHttpUrl` from
 * `@surakkha/shared/urlValidation` rejects `javascript:`, `data:`,
 * `file:`, `vbscript:`, relative paths, malformed URLs. The 400
 * response shape is `invalid_payload` with the same message the
 * helper throws (single source of truth for the toast copy).
 *
 * SECURITY (XSS): the `label` field is stored as-is and rendered by
 * the web as TEXT inside a `<p>` (no `dangerouslySetInnerHTML`).
 * The URL is rendered via `<a rel="noopener noreferrer" target="_blank">`
 * — even if a `javascript:` URL slipped past validation (it can't —
 * the helper blocks it), the `noopener noreferrer` mitigates
 * tab-nabbing and the `target="_blank"` would still need to be
 * clickable for the XSS to fire.
 *
 * Attachments are NOT state transitions: no `incident:state_changed`
 * socket emit, no `Notification` row. They're evidence attached to
 * the current state.
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";
import { detectMimeFromURL, FALLBACK_MIME } from "@surakkha/shared/mimeAutoDetect";
import { InvalidUrlError, validateHttpUrl } from "@surakkha/shared/urlValidation";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import { type AttachmentRepository, type AttachmentRow } from "./attachmentRepository.js";
import { attachmentRowToPayload } from "./attachmentRowToPayload.js";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

const idPathSchema = z.object({
  id: z.string().uuid(),
});

const attachmentIdPathSchema = z.object({
  id: z.string().uuid(),
});

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
  /**
   * The `Incident` table is owned by `incidentStateRepository`
   * (Story 4.2). 4.13 needs a narrow read-side slice for the
   * Tech-ownership check (a Technician can only POST/GET
   * attachments on incidents they're assigned to). The injection
   * keeps the dependency explicit — the attachment router doesn't
   * reach into the full incident state machine.
   */
  readonly incidentFindUnique: (args: {
    readonly where: { readonly id: string };
  }) => Promise<{ readonly assigneeUserId: string | null } | null>;
}

/**
 * Validate the URL string. Returns `null` if valid (caller
 * proceeds); returns a `Response` with 400 if it fails (caller
 * writes the response and returns). Lives at module scope so it
 * doesn't capture `buildAttachmentRouter` deps (and so the
 * `unicorn/consistent-function-scoping` rule accepts the
 * placement).
 *
 * SECURITY: `validateHttpUrl` rejects `javascript:`,
 * `data:text/html`, `file:`, `vbscript:`, relative paths, and
 * malformed URLs — the security boundary that prevents XSS
 * via the rendered `<a href>`. The thrown error message
 * surfaces to the operator's toast (single source of truth).
 */
const validateUrlOrRespond = (res: Response, url: string): Response | null => {
  try {
    validateHttpUrl(url);
  } catch (err) {
    const message =
      err instanceof InvalidUrlError ? err.message : "URL must be http:// or https://";
    return res.status(HTTP_BAD_REQUEST).json({
      error: "invalid_payload",
      issues: [{ path: ["url"], message }],
    });
  }
  return null;
};

/**
 * Build the attachment router. Mounted in `packages/api/src/index.ts`
 * after `authenticate` (so `req.user` is populated).
 */
export const buildAttachmentRouter = (deps: AttachmentRouterDeps): Router => {
  const router = express.Router();

  /**
   * Per-row ownership check for DELETE. Admin bypasses; the
   * original uploader can delete their own attachment; a
   * different Operator/Technician gets 403 (the matrix `delete
   * × Attachment` only grants Admin, but the per-row rule is
   * inclusive of the uploader for any role). Captures `deps`
   * (closure) for the audit logger.
   */
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
      error: "forbidden",
      required_role: "Admin",
    });
  };

  /**
   * Helper: enforce Tech-ownership on a parent incident. Returns
   * `null` if the check passes (caller proceeds); returns a `Response`
   * if it fails (caller writes the response and returns). Mirrors
   * 4.4's `router.ts:251-265` shape so the audit + status-code
   * semantics stay consistent.
   */
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
      return res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    }
    if (incident === null) {
      return res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
    }
    if (incident.assigneeUserId !== req.user.id) {
      deps.audit.emit({
        auditAction: "rbac_denied",
        userId: req.user.id,
        outcome: "failure",
        context: {
          subject: "Technician",
          action: "create",
          resource: "Attachment",
          reason: "not_assignee",
        },
      });
      return res.status(HTTP_FORBIDDEN).json({
        error: "forbidden",
        required_role: "Technician",
      });
    }
    return null;
  };

  /**
   * Create the attachment row in the repository. Captures
   * `deps` (closure) so it lives inside `buildAttachmentRouter`.
   * Returns `null` on success (caller writes 201); returns a
   * `Response` on failure (caller writes the error and returns).
   * Extracted from the POST handler to drop the handler's cyclomatic
   * complexity under the `complexity: 10` ESLint ceiling. Args
   * are bundled to stay under the `max-params: 3` rule.
   */
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
      return res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
    }
  };

  /**
   * POST /api/incidents/:id/attachments — create.
   * RBAC: `create × Attachment` (matrix grants Admin + Operator +
   * Technician; Viewer returns 403). URL validation rejects
   * non-http(s) schemes at the body-schema level.
   */
  router.post(
    "/api/incidents/:id/attachments",
    authorize({ action: "create", resource: "Attachment" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "validation_error",
          issues: idParsed.error.issues,
        });
        return;
      }
      const { id } = idParsed.data;
      const bodyParsed = createBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "invalid_payload",
          issues: bodyParsed.error.issues,
        });
        return;
      }
      // URL validation rejects javascript:/data:/file:/vbscript:,
      // relative paths, malformed URLs (security boundary).
      const urlDenied = validateUrlOrRespond(res, bodyParsed.data.url);
      if (urlDenied !== null) return;
      // Tech-ownership: a Technician can only POST on incidents
      // they're assigned to. Admin / Operator / Viewer skip this.
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

  /**
   * GET /api/incidents/:id/attachments — list (reverse-chrono).
   * RBAC: `read × Attachment` (matrix grants all four roles).
   * Tech-ownership narrows to assigned incidents.
   */
  router.get(
    "/api/incidents/:id/attachments",
    authorize({ action: "read", resource: "Attachment" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "validation_error",
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
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      const body = {
        attachments: rows.map((r) => attachmentRowToPayload(r)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  /**
   * DELETE /api/attachments/:id — delete one.
   * RBAC: `delete × Attachment` (matrix grants Admin only); the
   * per-row "uploader can delete own" check fires AFTER the matrix
   * gate. The original uploader (Operator/Technician) passes the
   * per-row check; a different Operator/Technician gets 403 even
   * though their role can read the row.
   */
  router.delete(
    "/api/attachments/:id",
    authorize({ action: "delete", resource: "Attachment" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = attachmentIdPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res.status(HTTP_BAD_REQUEST).json({
          error: "validation_error",
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
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      if (row === null) {
        res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
        return;
      }
      // Per-row ownership check (Admin bypass + uploader check).
      const ownershipDenied = enforceDeleteOwnership(req, res, row);
      if (ownershipDenied !== null) return;
      try {
        await deps.repo.attachment.delete({ where: { id } });
      } catch (err) {
        console.error("api/attachments: delete failed", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      res.status(HTTP_NO_CONTENT).send();
    },
  );

  return router;
};
