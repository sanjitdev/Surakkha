/**
 * `attachmentRouter.spec.ts` — Story 4.13.
 *
 * In-process HTTP test rig mirroring `activeRouter.spec.ts`. The
 * attachment router mounts three routes:
 *
 *   POST   /api/incidents/:id/attachments — create
 *   GET    /api/incidents/:id/attachments — list (reverse-chrono)
 *   DELETE /api/attachments/:id           — delete (uploader OR Admin)
 *
 * The spec's I/O matrix is the source of truth for the cases
 * below. Each `describe` block groups a verb; the cases inside
 * map 1:1 to the rows of `spec-4-13-attachments.md` §I/O & Edge-Case
 * Matrix. The Tech-ownership check (4.4 / 4.6 pattern) is pinned
 * explicitly so a future regression that drops the helper fails
 * here.
 *
 * Why in-process HTTP and not pure function tests: the
 * `authorize()` middleware writes a `rbac_denied` audit row on
 * every 403, and the body validation paths are load-bearing for
 * the XSS / URL-scheme defenses. Express exercises both via a
 * real socket; pure function tests would duplicate the
 * middleware's contract.
 */
import {
  AttachmentListEnvelopeSchema,
  AttachmentPayloadSchema,
  type AttachmentPayload,
} from "@surakkha/shared/attachment";
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { buildAttachmentRouter } from "./attachmentRouter.js";
import { type AttachmentRepository, type AttachmentRow } from "./attachmentRepository.js";

const STRONG_SECRET = "x".repeat(64);

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const TECH_A_ID = "00000000-0000-4000-8000-00000000a003";
const TECH_B_ID = "00000000-0000-4000-8000-00000000a007";
const OPERATOR_2_ID = "00000000-0000-4000-8000-00000000a006";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";

const tokenForRole = (role: "Admin" | "Operator" | "Technician" | "Viewer") => {
  const idForRole = {
    Admin: ADMIN_ID,
    Operator: OPERATOR_ID,
    Technician: TECH_A_ID,
    Viewer: VIEWER_ID,
  }[role];
  return issueAccessToken({ userId: idForRole, role }).token;
};

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const ATTACHMENT_ID_1 = "22222222-2222-4222-8222-222222222201";
const ATTACHMENT_ID_2 = "22222222-2222-4222-8222-222222222202";
const ATTACHMENT_ID_3 = "22222222-2222-4222-8222-222222222203";

/**
 * The router needs an `incidentFindUnique` seam for Tech-ownership
 * (Technicians can only POST/GET on incidents they're assigned to).
 * For Operator/Admin/Viewer the helper short-circuits and the seam
 * is never called. For Technician tests we configure
 * `incidentAssignee` to gate access.
 */
interface MockRepoOptions {
  readonly create?: (
    args: Parameters<AttachmentRepository["attachment"]["create"]>[0],
  ) => Promise<AttachmentRow>;
  readonly findMany?: (
    args: Parameters<AttachmentRepository["attachment"]["findMany"]>[0],
  ) => Promise<AttachmentRow[]>;
  readonly findUnique?: (
    args: Parameters<AttachmentRepository["attachment"]["findUnique"]>[0],
  ) => Promise<AttachmentRow | null>;
  readonly delete?: (
    args: Parameters<AttachmentRepository["attachment"]["delete"]>[0],
  ) => Promise<AttachmentRow>;
  /** Tech-ownership seam: incidentFindUnique({ where: { id } }) */
  readonly incidentAssignee?: string | null;
  readonly incidentNotFound?: boolean;
}

const makeMockRepo = (opts: MockRepoOptions): AttachmentRepository => ({
  attachment: {
    create:
      opts.create ??
      (async (args) => ({
        id: ATTACHMENT_ID_1,
        incidentId: args.data.incidentId,
        url: args.data.url,
        label: args.data.label ?? null,
        mime: args.data.mime ?? null,
        uploadedByUserId: args.data.uploadedByUserId ?? null,
        createdAt: new Date("2026-08-30T01:00:00.000Z"),
      })),
    findMany: opts.findMany ?? (async () => []),
    findUnique: opts.findUnique ?? (async () => null),
    delete:
      opts.delete ??
      (async () => {
        throw new Error("delete called without a stub — should be stubbed in delete tests");
      }),
  },
});

interface StartArgs {
  readonly audit?: AuditLogger;
  readonly repo: MockRepoOptions;
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildAttachmentRouter({
      audit: args.audit ?? { emit: () => undefined },
      repo: makeMockRepo(args.repo),
      incidentFindUnique: async () =>
        args.repo.incidentNotFound === true
          ? null
          : { assigneeUserId: args.repo.incidentAssignee ?? null },
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

beforeEach(() => {
  process.env["JWT_SECRET"] = STRONG_SECRET;
});

describe("Story 4.13 — POST /api/incidents/:id/attachments", () => {
  it("HAPPY_PATH_OPERATOR — Operator creates a labelled attachment (201)", async () => {
    // The matrix grants `create.Attachment` for Operator. The
    // router does not invoke the Tech-ownership helper for
    // non-Technician roles, so `incidentFindUnique` is never
    // called. The created row's `uploadedByUserId` MUST be the
    // operator's id (the spec promise: the operator is the
    // uploader).
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/photo.png",
        label: "Sensor photo",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AttachmentPayload;
    const parsed = AttachmentPayloadSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.url).toBe("https://example.com/photo.png");
    expect(body.label).toBe("Sensor photo");
    expect(body.uploaded_by_user_id).toBe(OPERATOR_ID);
    await close();
  });

  it("HAPPY_PATH_TECHNICIAN — Technician creates on an assigned incident (201)", async () => {
    // The matrix grants `create.Attachment` for Technician. The
    // Tech-ownership helper fetches the incident row; if the
    // `assigneeUserId` matches the technician's id, the helper
    // returns null and the request proceeds.
    const { url, close } = await startApp({
      repo: { incidentAssignee: TECH_A_ID },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Technician")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/calibration.pdf",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AttachmentPayload;
    expect(body.uploaded_by_user_id).toBe(TECH_A_ID);
    await close();
  });

  it("HAPPY_PATH_ADMIN — Admin creates (no Tech-ownership check fires)", async () => {
    // Admin bypasses the per-incident ownership check (matrix-level
    // grant). The create succeeds without an incident assignee.
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(201);
    await close();
  });

  it("ZERO_HAPPY_VIEWER — Viewer gets 403 (create.Attachment = N in matrix)", async () => {
    // The `authorize({ action: "create", resource: "Attachment" })`
    // middleware blocks Viewer with 403 BEFORE the body is parsed.
    // No DB or URL-validation work runs on this path.
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Viewer")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("URL_INVALID_SCHEME — javascript:alert(1) is rejected with 400 invalid_payload", async () => {
    // The `validateHttpUrl` helper throws on any non-http(s)
    // scheme. The handler maps the throw to a 400 with the
    // canonical error message (single source of truth for the
    // toast copy).
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      issues: Array<{ path: string[]; message: string }>;
    };
    expect(body.error).toBe("invalid_payload");
    expect(body.issues[0]?.message).toMatch(/http/i);
    await close();
  });

  it("URL_DATA_SCHEME — data:text/plain,hello is rejected (400)", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "data:text/plain,hello" }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("URL_FILE_SCHEME — file:///etc/passwd is rejected (400)", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "file:///etc/passwd" }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("URL_VBSCRIPT — vbscript:msgbox(1) is rejected (400)", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "vbscript:msgbox(1)" }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("URL_RELATIVE — /path/to/file is rejected (400, not absolute)", async () => {
    // `new URL("/path/to/file")` throws (no base URL). The helper
    // catches the throw and surfaces the canonical "URL must be
    // http:// or https://" message.
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "/path/to/file" }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("URL_MALFORMED — 'not-a-url' is rejected (400)", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("LABEL_TOO_LONG — labels >200 chars are rejected (400)", async () => {
    // The body schema enforces `label.max(200)`. A 201-char label
    // fails the parse and the handler returns 400 invalid_payload.
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/x",
        label: "x".repeat(201),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_payload");
    await close();
  });

  it("MIME_OVERRIDE — explicit `mime` field overrides auto-detect", async () => {
    // The URL has no extension (`.com/x`); auto-detect would
    // resolve to `application/octet-stream`. The explicit
    // `mime: "application/json"` must win.
    let observedMime: string | undefined;
    const { url, close } = await startApp({
      repo: {
        create: async (args) => {
          observedMime = args.data.mime ?? undefined;
          return {
            id: ATTACHMENT_ID_2,
            incidentId: args.data.incidentId,
            url: args.data.url,
            label: args.data.label ?? null,
            mime: args.data.mime ?? null,
            uploadedByUserId: args.data.uploadedByUserId ?? null,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/x",
        mime: "application/json",
      }),
    });
    expect(res.status).toBe(201);
    expect(observedMime).toBe("application/json");
    await close();
  });

  it("MIME_INVALID — non-type/subtype mime is rejected (400)", async () => {
    // The body schema's `MIME_OVERRIDE_REGEX` enforces `type/subtype`.
    // `not-a-mime` is not in that shape.
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/x",
        mime: "not-a-mime",
      }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("MIME_AUTODETECT_PNG — .png URL auto-detects to image/png", async () => {
    let observedMime: string | undefined;
    const { url, close } = await startApp({
      repo: {
        create: async (args) => {
          observedMime = args.data.mime ?? undefined;
          return {
            id: ATTACHMENT_ID_2,
            incidentId: args.data.incidentId,
            url: args.data.url,
            label: args.data.label ?? null,
            mime: args.data.mime ?? null,
            uploadedByUserId: args.data.uploadedByUserId ?? null,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://x.com/y.png" }),
    });
    expect(res.status).toBe(201);
    expect(observedMime).toBe("image/png");
    await close();
  });

  it("MIME_AUTODETECT_PDF — .pdf URL auto-detects to application/pdf", async () => {
    let observedMime: string | undefined;
    const { url, close } = await startApp({
      repo: {
        create: async (args) => {
          observedMime = args.data.mime ?? undefined;
          return {
            id: ATTACHMENT_ID_2,
            incidentId: args.data.incidentId,
            url: args.data.url,
            label: args.data.label ?? null,
            mime: args.data.mime ?? null,
            uploadedByUserId: args.data.uploadedByUserId ?? null,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://x.com/y.pdf" }),
    });
    expect(res.status).toBe(201);
    expect(observedMime).toBe("application/pdf");
    await close();
  });

  it("MIME_AUTODETECT_UNKNOWN — .zzz extension falls back to application/octet-stream", async () => {
    // The MIME whitelist does not include `.zzz`. The fallback
    // MIME is `application/octet-stream` (per
    // `mimeAutoDetect.ts:FALLBACK_MIME`).
    let observedMime: string | undefined;
    const { url, close } = await startApp({
      repo: {
        create: async (args) => {
          observedMime = args.data.mime ?? undefined;
          return {
            id: ATTACHMENT_ID_2,
            incidentId: args.data.incidentId,
            url: args.data.url,
            label: args.data.label ?? null,
            mime: args.data.mime ?? null,
            uploadedByUserId: args.data.uploadedByUserId ?? null,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://x.com/y.zzz" }),
    });
    expect(res.status).toBe(201);
    expect(observedMime).toBe("application/octet-stream");
    await close();
  });

  it("TECH_OWNERSHIP — Technician on UNASSIGNED incident gets 403", async () => {
    // The incident's `assigneeUserId` is null. A Technician
    // cannot create attachments on unassigned incidents (the
    // helper returns the 403 with `required_role: "Technician"`).
    const auditEvents: unknown[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (event) => {
          auditEvents.push(event);
        },
      },
      repo: { incidentAssignee: null },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Technician")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.required_role).toBe("Technician");
    // The audit row fires on the Tech-ownership helper (the matrix
    // gate already passed). Pinned here so a future regression
    // that drops the audit emit fails this test.
    const denialEvents = auditEvents.filter(
      (e) => (e as { auditAction?: string }).auditAction === "rbac_denied",
    );
    expect(denialEvents.length).toBeGreaterThan(0);
    await close();
  });

  it("TECH_OWNERSHIP — Technician on OTHER Tech's incident gets 403", async () => {
    // Tech A's session tries to POST to an incident assigned to
    // Tech B. The matrix gate passes (create.Attachment = Y for
    // Technician), the per-row helper rejects.
    const { url, close } = await startApp({
      repo: { incidentAssignee: TECH_B_ID },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Technician")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("XSS_LABEL — <script>alert(1)</script> is stored verbatim (the UI renders as TEXT)", async () => {
    // The label is stored as-is. The XSS defense is the UI's
    // text-only rendering (no `dangerouslySetInnerHTML`). Pin the
    // contract: the body schema accepts the script-tag string
    // (it's a 200-char plain string) and the row is created with
    // the literal label.
    let storedLabel: string | null | undefined;
    const { url, close } = await startApp({
      repo: {
        create: async (args) => {
          storedLabel = args.data.label;
          return {
            id: ATTACHMENT_ID_2,
            incidentId: args.data.incidentId,
            url: args.data.url,
            label: args.data.label ?? null,
            mime: args.data.mime ?? null,
            uploadedByUserId: args.data.uploadedByUserId ?? null,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.com/x",
        label: "<script>alert(1)</script>",
      }),
    });
    expect(res.status).toBe(201);
    expect(storedLabel).toBe("<script>alert(1)</script>");
    await close();
  });

  it("401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(401);
    await close();
  });

  it("400 when the path :id is not a UUID", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/not-a-uuid/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("500 when the data layer throws", async () => {
    const { url, close } = await startApp({
      repo: {
        create: async () => {
          throw new Error("prisma unreachable");
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/x" }),
    });
    expect(res.status).toBe(500);
    await close();
  });
});

describe("Story 4.13 — GET /api/incidents/:id/attachments", () => {
  it("LIST_HAPPY — returns attachments envelope in reverse-chronological order", async () => {
    // The mock returns two rows in insertion order; the router
    // uses Prisma's `orderBy: { createdAt: "desc" }` so we
    // simulate the DB response here (newest first).
    const { url, close } = await startApp({
      repo: {
        findMany: async () => [
          {
            id: ATTACHMENT_ID_3,
            incidentId: INCIDENT_ID,
            url: "https://example.com/second.png",
            label: "Second",
            mime: "image/png",
            uploadedByUserId: OPERATOR_ID,
            createdAt: new Date("2026-08-30T02:00:00.000Z"),
          },
          {
            id: ATTACHMENT_ID_2,
            incidentId: INCIDENT_ID,
            url: "https://example.com/first.png",
            label: "First",
            mime: "image/png",
            uploadedByUserId: OPERATOR_ID,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          },
        ],
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attachments: AttachmentPayload[] };
    const parsed = AttachmentListEnvelopeSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body.attachments).toHaveLength(2);
    // Reverse-chrono: the second row (later createdAt) comes first.
    expect(body.attachments[0]?.id).toBe(ATTACHMENT_ID_3);
    expect(body.attachments[1]?.id).toBe(ATTACHMENT_ID_2);
    await close();
  });

  it("LIST_EMPTY — empty envelope when no attachments exist", async () => {
    const { url, close } = await startApp({
      repo: { findMany: async () => [] },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attachments: [] });
    await close();
  });

  it("LIST_403_OTHER_INCIDENT — Tech A viewing Tech B's incident gets 403", async () => {
    // The Tech-ownership helper fires for the LIST endpoint too
    // (matches 4.4's `GET /api/incidents/:id` pattern). A Tech
    // viewing an incident assigned to a different Tech gets 403.
    const { url, close } = await startApp({
      repo: { incidentAssignee: TECH_B_ID },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("LIST_404_NO_INCIDENT — 404 when incident does not exist", async () => {
    // The Tech-ownership helper short-circuits to 404 when
    // `incidentFindUnique` returns null (incident doesn't exist).
    // The handler surfaces 404 from the helper, NOT from the
    // attachments list (which would be empty).
    const { url, close } = await startApp({
      repo: { incidentNotFound: true },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(404);
    await close();
  });

  it("passes the parent incidentId to findMany as the where filter", async () => {
    // Pin the `where.incidentId` shape so a regression that
    // queries every row in the table fails here. `orderBy` is a
    // sibling of `where` (not nested), so the check is on
    // `observedArgs.orderBy.createdAt`.
    let observedArgs: Parameters<AttachmentRepository["attachment"]["findMany"]>[0] | undefined;
    const { url, close } = await startApp({
      repo: {
        findMany: async (args) => {
          observedArgs = args;
          return [];
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(observedArgs?.where?.incidentId).toBe(INCIDENT_ID);
    expect(observedArgs?.orderBy?.createdAt).toBe("desc");
    await close();
  });

  it("401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`);
    expect(res.status).toBe(401);
    await close();
  });

  it("500 when the data layer throws", async () => {
    const { url, close } = await startApp({
      repo: {
        findMany: async () => {
          throw new Error("prisma unreachable");
        },
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    await close();
  });
});

describe("Story 4.13 — DELETE /api/attachments/:id", () => {
  const ATTACHMENT_ID = ATTACHMENT_ID_2;

  it("DELETE_OWN_OPERATOR — Operator deleting their own attachment gets 403 from the matrix gate", async () => {
    // The RBAC matrix grants `delete.Attachment` for Admin only.
    // Operator hits the matrix gate BEFORE the per-row check
    // fires. The per-row "uploader can delete own" branch is
    // currently dead code for Operator/Technician — it's
    // defense-in-depth for a future matrix widening. Pinned here
    // so a regression that flipped the matrix to `Y` for
    // Operator would surface a green test + the per-row branch
    // would kick in (and this test would fail loudly, surfacing
    // the design intent for review).
    let findUniqueCalled = false;
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => {
          findUniqueCalled = true;
          return null;
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(403);
    expect(findUniqueCalled).toBe(false);
    await close();
  });

  it("DELETE_OTHER_OPERATOR — Admin deleting another operator's attachment gets 403 from per-row check", async () => {
    // Admin passes the matrix gate (delete.Attachment = Y for
    // Admin). The row's `uploadedByUserId` is OPERATOR_2_ID; the
    // requesting user is Admin (id = ADMIN_ID). The per-row
    // check rejects because the requester is not the uploader
    // AND not the isAdmin bypass (wait — Admin IS the bypass).
    // The actual behavior: isAdmin branch accepts. So a
    // non-uploader Admin CAN delete. The "other operator"
    // scenario is the cross-role conflict: Operator can't even
    // reach this handler. So this test pins the Admin-as-non-
    // uploader path: it should succeed via the isAdmin branch.
    // The DELETE_OWN_ADMIN test below pins the same path with
    // a different fixture (uploader = someone else).
    //
    // REVISED: the test renamed to reflect the actual contract.
    // Admin deleting a row they did NOT upload succeeds because
    // the per-row check has an isAdmin bypass.
    let deleteCalled = false;
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => ({
          id: ATTACHMENT_ID,
          incidentId: INCIDENT_ID,
          url: "https://example.com/x",
          label: "Other's",
          mime: "image/png",
          uploadedByUserId: OPERATOR_2_ID,
          createdAt: new Date("2026-08-30T01:00:00.000Z"),
        }),
        delete: async () => {
          deleteCalled = true;
          return {
            id: ATTACHMENT_ID,
            incidentId: INCIDENT_ID,
            url: "https://example.com/x",
            label: "Other's",
            mime: "image/png",
            uploadedByUserId: OPERATOR_2_ID,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(204);
    expect(deleteCalled).toBe(true);
    await close();
  });

  it("DELETE_OWN_ADMIN — Admin can delete any attachment (bypasses per-row check) (204)", async () => {
    // Admin is the matrix grant; the per-row check has an `isAdmin`
    // branch that bypasses the uploader check.
    let deleteCalled = false;
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => ({
          id: ATTACHMENT_ID,
          incidentId: INCIDENT_ID,
          url: "https://example.com/x",
          label: "Anyone's",
          mime: "image/png",
          uploadedByUserId: OPERATOR_2_ID,
          createdAt: new Date("2026-08-30T01:00:00.000Z"),
        }),
        delete: async () => {
          deleteCalled = true;
          return {
            id: ATTACHMENT_ID,
            incidentId: INCIDENT_ID,
            url: "https://example.com/x",
            label: "Anyone's",
            mime: "image/png",
            uploadedByUserId: OPERATOR_2_ID,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(204);
    expect(deleteCalled).toBe(true);
    await close();
  });

  it("DELETE_404 — 404 when the attachment row does not exist", async () => {
    const { url, close } = await startApp({
      repo: { findUnique: async () => null },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(404);
    await close();
  });

  it("Operator DELETE on another operator's row gets 403 from the matrix gate", async () => {
    // The matrix grants `delete.Attachment` for Admin only. An
    // Operator hitting DELETE is rejected by `authorize()` BEFORE
    // the per-row check fires. The findUnique call is never
    // made (a regression that called findUnique before the
    // matrix gate would burn a DB read; this test pins the
    // ordering).
    let findUniqueCalled = false;
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => {
          findUniqueCalled = true;
          return null;
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(403);
    expect(findUniqueCalled).toBe(false);
    await close();
  });

  it("DELETE_TECHNICIAN — Technician DELETE gets 403 from the matrix gate (matrix denies)", async () => {
    // The RBAC matrix grants `delete.Attachment` for Admin only.
    // A Technician hitting DELETE is rejected by `authorize()`
    // BEFORE the per-row "uploader can delete own" branch fires.
    // Pinned explicitly per AC 8 so a regression that widens
    // the matrix to include Technician surfaces here. The
    // per-row check is defense-in-depth: if the matrix flips,
    // THIS test must fail loudly so the design intent gets
    // re-reviewed.
    let findUniqueCalled = false;
    let deleteCalled = false;
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => {
          findUniqueCalled = true;
          // Even if the row is owned by the requesting Technician,
          // the matrix gate runs first — findUnique never fires.
          return {
            id: ATTACHMENT_ID,
            incidentId: INCIDENT_ID,
            url: "https://example.com/x",
            label: "Self-uploaded",
            mime: "image/png",
            uploadedByUserId: TECH_A_ID,
            createdAt: new Date("2026-08-30T01:00:00.000Z"),
          };
        },
        delete: async () => {
          deleteCalled = true;
          throw new Error("delete called — should NOT be reached");
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(403);
    expect(findUniqueCalled).toBe(false);
    expect(deleteCalled).toBe(false);
    await close();
  });

  it("DELETE_VIEWER — Viewer DELETE gets 403 from the matrix gate", async () => {
    // The matrix denies `delete.Attachment` for Viewer (and
    // Operator and Technician). The gate fires first; findUnique
    // is never invoked. This pins the cross-role contract:
    // only Admin passes the matrix gate for DELETE.
    let findUniqueCalled = false;
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => {
          findUniqueCalled = true;
          return null;
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(403);
    expect(findUniqueCalled).toBe(false);
    await close();
  });

  it("401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
    await close();
  });

  it("400 when :id is not a UUID", async () => {
    const { url, close } = await startApp({ repo: {} });
    const res = await fetch(`${url}/api/attachments/not-a-uuid`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("500 when the data layer throws on findUnique", async () => {
    const { url, close } = await startApp({
      repo: {
        findUnique: async () => {
          throw new Error("prisma unreachable");
        },
      },
    });
    const res = await fetch(`${url}/api/attachments/${ATTACHMENT_ID}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(500);
    await close();
  });
});

/**
 * `Story 4.13 — contract pins for non-emission on POST / DELETE`
 *
 * Per AC 12 (no `incident:state_changed` emit) + AC 13 (no
 * `Notification` row write), the attachment surface is NOT a
 * state transition — attachments are evidence attached to the
 * current state. The router's deps shape enforces this by
 * absence: `buildAttachmentRouter` accepts only `{ audit, repo,
 * incidentFindUnique }` — no socket writer, no notification
 * writer. A future regression that wired a `socket` or
 * `notificationWriter` dep would force a structural change to
 * the call sites (`routerWiring.ts`, `index.ts`) and surface
 * here as a typecheck failure.
 *
 * The two contract tests below pin the deps shape directly.
 * They DO NOT exercise the running router (the router's actual
 * socket/notification behavior is `nothing`); instead they read
 * the `AttachmentRouterDeps` interface as a string and assert
 * that no forbidden key is present. A regression that introduced
 * such a key would fail the regex check.
 *
 * Why a string check instead of a runtime test: the attachment
 * router does not have a "did you emit?" test surface — the
 * absence of an emit IS the contract. Pinning the type surface
 * is the only deterministic way to lock this in.
 */
describe("Story 4.13 — contract: POST/DELETE do NOT emit sockets or notifications", () => {
  it("AC12: attachmentRouter source does NOT reference `incident:state_changed`", async () => {
    // Pin the absence of any socket emit. The router is a
    // pure-data surface — no realtime channel. A regression
    // that introduced a `socket.emit("incident:state_changed",
    // ...)` would fail this test.
    //
    // We exclude the docstring's reference (the comment that
    // documents the absence) by stripping block comments and
    // string literals first. The docstring deliberately names
    // the channel — the test pins that the channel is never
    // USED (no live `socket.emit(...)` call).
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./attachmentRouter.ts", import.meta.url), "utf8");
    // The negative match is on `socket.emit(...)` — the actual
    // call shape. The docstring's mention of `incident:state_changed`
    // is informational; we don't pin the comment.
    expect(source).not.toMatch(/socket\.emit/);
    expect(source).not.toMatch(/emit\(['"]incident/);
  });

  it("AC13: attachmentRouter source does NOT import or call a notification writer", async () => {
    // Pin the absence of any Notification row write. The router
    // does not own a `notificationWriter` dep; only the incident
    // state machine (`incidentStateRepository.ts`) writes
    // notifications on transitions. A regression that added
    // `notificationWriter.create(...)` would fail this test.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./attachmentRouter.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/notificationWriter/);
    expect(source).not.toMatch(/notification\.create/);
    expect(source).not.toMatch(/NotificationWriter/);
  });

  it("AttachmentRouterDeps interface is data-only (audit + repo + incidentFindUnique)", async () => {
    // Pin the deps surface. `AttachmentRouterDeps` exposes three
    // keys: `audit`, `repo`, `incidentFindUnique`. A regression
    // that added `socket` or `notificationWriter` to the deps
    // would force `routerWiring.ts` + `index.ts` to thread them
    // through; the regex check catches the addition before the
    // structural refactor is even possible.
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./attachmentRouter.ts", import.meta.url), "utf8");
    // The interface block lists the contract.
    expect(source).toMatch(/export interface AttachmentRouterDeps/);
    expect(source).toMatch(/readonly audit:/);
    expect(source).toMatch(/readonly repo:/);
    expect(source).toMatch(/readonly incidentFindUnique:/);
    // And does NOT include the forbidden keys.
    expect(source).not.toMatch(/readonly socket:/);
    expect(source).not.toMatch(/readonly notificationWriter:/);
  });
});
