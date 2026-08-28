/**
 * `notificationRouter.spec.ts` — Story 4.10.
 *
 * Coverage (each I/O matrix row → at least one `it(...)`):
 *
 *   - GET happy-path (Operator + 3 rows) → 200 + envelope shape
 *   - GET empty (Operator + 0 rows) → 200 + empty envelope
 *   - GET Viewer 403 → rbac_denied audit + 403 body
 *   - GET no auth 401 → unauthenticated
 *   - GET 500 → prisma throw surfaces 500
 *   - GET pass-through to repo: filter shape (recipientRole +
 *     acknowledgedAt: null), orderBy, take
 *
 *   - PATCH happy-path (Operator acks Operator-targeted row) →
 *     200 + row payload
 *   - PATCH idempotent (already-acknowledged row) → 200 + the
 *     existing row (NOT 409)
 *   - PATCH 403 cross-role (Operator tries to ack Admin-targeted
 *     row) → 403 + rbac_denied audit
 *   - PATCH 404 (missing id) → 404 + not_found body
 *   - PATCH 400 (malformed id) → 400 + validation_error body
 *
 * The test rig mirrors the 3.5 `acknowledgeRouter.spec.ts` and
 * 4.3 `activeRouter.spec.ts` patterns: in-process Express +
 * `http.createServer` + a stub repo that captures the
 * `findMany` / `findUnique` / `updateMany` arguments so the
 * handler's pass-through can be asserted without spinning up
 * Prisma.
 */
import { type NotificationPayload } from "@surakkha/shared/notification";
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { type NotificationRow, type NotificationRepository } from "./notificationRepository.js";
import { buildNotificationRouter } from "./notificationRouter.js";

const STRONG_SECRET = "x".repeat(64);

const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const TECHNICIAN_ID = "00000000-0000-4000-8000-00000000a003";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";
const INCIDENT_ID_1 = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID_2 = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID_3 = "33333333-3333-4333-8333-333333333333";
const NOTIF_ID_1 = "a1111111-1111-4111-8111-111111111111";
const NOTIF_ID_2 = "a2222222-2222-4222-8222-222222222222";
const NOTIF_ID_3 = "a3333333-3333-4333-8333-333333333333";

const tokenForRole = (
  role: "Admin" | "Operator" | "Technician" | "Viewer",
  userId?: string,
): string =>
  issueAccessToken({
    userId:
      userId ??
      (role === "Admin"
        ? ADMIN_ID
        : role === "Operator"
          ? OPERATOR_ID
          : role === "Technician"
            ? TECHNICIAN_ID
            : VIEWER_ID),
    role,
  }).token;

/**
 * Build a `NotificationRow` fixture with sensible defaults. The
 * `recipientRole` + `acknowledgedAt` fields are the load-bearing
 * test inputs and are pinned explicitly per test.
 */
const baseRow = (overrides: Partial<NotificationRow> & { id: string }): NotificationRow => ({
  id: overrides.id,
  severity: "critical",
  incidentId: INCIDENT_ID_1,
  alertId: null,
  recipientRole: "Operator",
  createdAt: new Date("2026-08-28T10:00:00.000Z"),
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  ...overrides,
});

interface StartArgs {
  readonly audit: AuditLogger;
  readonly findMany: NotificationRepository["notification"]["findMany"];
  readonly findUnique: NotificationRepository["notification"]["findUnique"];
  readonly updateMany: NotificationRepository["notification"]["updateMany"];
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildNotificationRouter({
      audit: args.audit,
      repo: {
        notification: {
          findMany: args.findMany,
          findUnique: args.findUnique,
          updateMany: args.updateMany,
        },
      },
      now: () => new Date("2026-08-28T12:00:00.000Z"),
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

describe("Story 4.10 — GET /api/notifications", () => {
  it("HAPPY_PATH: returns unread notifications for the viewer's role in createdAt DESC order", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        findManyCalls.push(args);
        return [
          baseRow({
            id: NOTIF_ID_1,
            severity: "critical",
            incidentId: INCIDENT_ID_1,
            createdAt: new Date("2026-08-28T11:00:00.000Z"),
          }),
          baseRow({
            id: NOTIF_ID_2,
            severity: "critical",
            incidentId: INCIDENT_ID_2,
            createdAt: new Date("2026-08-28T10:30:00.000Z"),
          }),
          baseRow({
            id: NOTIF_ID_3,
            severity: "warning",
            incidentId: INCIDENT_ID_3,
            createdAt: new Date("2026-08-28T10:00:00.000Z"),
          }),
        ];
      },
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: NotificationPayload[] };
    expect(body.notifications).toHaveLength(3);
    // Newest first.
    expect(body.notifications.map((n) => n.id)).toEqual([NOTIF_ID_1, NOTIF_ID_2, NOTIF_ID_3]);
    // Every row matches the canonical wire shape.
    for (const notif of body.notifications) {
      expect(notif.severity).toMatch(/^(info|warning|critical)$/);
      expect(notif.recipientRole).toBe("Operator");
      expect(notif.acknowledgedAt).toBeNull();
    }
    // The filter shape is pinned to the spec: recipientRole + acknowledgedAt: null.
    expect((findManyCalls[0] as { where: unknown })?.where).toEqual({
      recipientRole: "Operator",
      acknowledgedAt: null,
    });
    await close();
  });

  it("EMPTY: returns the empty envelope when no rows match", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifications: [] });
    await close();
  });

  it("RBAC: Viewer gets 403 (matrix grants Viewer.read.Notification = N)", async () => {
    const auditCalls: unknown[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (event) => {
          auditCalls.push(event);
        },
      },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    // `required_role` is the lowest-rank role that satisfies the grant.
    expect(["Admin", "Operator", "Technician"]).toContain(body.required_role);
    // The RBAC denial wrote an audit event.
    const denialAudit = auditCalls.find(
      (c): c is { auditAction: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { auditAction?: string }).auditAction === "rbac_denied",
    );
    expect(denialAudit).toBeDefined();
    await close();
  });

  it("AUTH: returns 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications`);
    expect(res.status).toBe(401);
    await close();
  });

  it("500: surfaces 500 when the data layer throws", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => {
        throw new Error("prisma unreachable");
      },
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    await close();
  });

  it("passes the right filter (recipientRole + acknowledgedAt: null) and ordering to the data layer", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        findManyCalls.push(args);
        return [];
      },
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as {
      where: unknown;
      orderBy: unknown;
      take: number;
    };
    expect(call?.where).toEqual({
      recipientRole: "Technician",
      acknowledgedAt: null,
    });
    expect(call?.orderBy).toEqual({ createdAt: "desc" });
    expect(call?.take).toBe(50);
    await close();
  });
});

describe("Story 4.10 — PATCH /api/notifications/:id/acknowledge", () => {
  it("HAPPY_PATH: Operator acks an Operator-targeted row → 200 + row payload", async () => {
    const updateCalls: unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: (() => {
        let callCount = 0;
        return async () => {
          callCount += 1;
          if (callCount === 1) return baseRow({ id: NOTIF_ID_1, recipientRole: "Operator" });
          return baseRow({
            id: NOTIF_ID_1,
            recipientRole: "Operator",
            acknowledgedAt: new Date("2026-08-28T12:00:00.000Z"),
            acknowledgedByUserId: OPERATOR_ID,
          });
        };
      })(),
      updateMany: async (args) => {
        updateCalls.push(args);
        return { count: 1 };
      },
    });
    const res = await fetch(`${url}/api/notifications/${NOTIF_ID_1}/acknowledge`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NotificationPayload;
    expect(body.id).toBe(NOTIF_ID_1);
    expect(body.acknowledgedAt).toBe("2026-08-28T12:00:00.000Z");
    const firstUpdate = updateCalls[0] as {
      where: unknown;
      data: { acknowledgedByUserId: string };
    };
    expect(firstUpdate?.where).toEqual({
      id: NOTIF_ID_1,
      acknowledgedAt: null,
    });
    expect(firstUpdate?.data.acknowledgedByUserId).toBe(OPERATOR_ID);
    await close();
  });

  it("IDEMPOTENT: re-acking an already-acknowledged row → 200 with the existing row (NOT 409)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: (() => {
        let _ignored = 0;
        return async () => {
          _ignored += 1;
          return baseRow({
            id: NOTIF_ID_1,
            recipientRole: "Operator",
            acknowledgedAt: new Date("2026-08-27T08:00:00.000Z"),
            acknowledgedByUserId: OPERATOR_ID,
          });
        };
      })(),
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications/${NOTIF_ID_1}/acknowledge`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NotificationPayload;
    expect(body.id).toBe(NOTIF_ID_1);
    expect(body.acknowledgedAt).toBe("2026-08-27T08:00:00.000Z");
    await close();
  });

  it("RBAC_CROSS_ROLE: Operator tries to ack an Admin-targeted row → 403 + rbac_denied audit", async () => {
    const auditCalls: unknown[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (event) => {
          auditCalls.push(event);
        },
      },
      findMany: async () => [],
      findUnique: async () => baseRow({ id: NOTIF_ID_1, recipientRole: "Admin" }),
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications/${NOTIF_ID_1}/acknowledge`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.required_role).toBe("Admin");
    const denialAudit = auditCalls.find(
      (c): c is { auditAction: string; context?: Record<string, unknown> } =>
        typeof c === "object" &&
        c !== null &&
        (c as { auditAction?: string }).auditAction === "rbac_denied",
    );
    expect(denialAudit).toBeDefined();
    expect(denialAudit?.context?.["reason"]).toBe("cross_role_recipient");
    await close();
  });

  it("NOT_FOUND: missing id → 404", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications/${NOTIF_ID_1}/acknowledge`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(404);
    await close();
  });

  it("VALIDATION: malformed id → 400", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications/not-a-uuid/acknowledge`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("AUTH: returns 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications/${NOTIF_ID_1}/acknowledge`, {
      method: "PATCH",
    });
    expect(res.status).toBe(401);
    await close();
  });

  it("RBAC_NO_BUTTON: Viewer cannot ack → 403 (matrix grants Viewer.acknowledge.Notification = N)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
    });
    const res = await fetch(`${url}/api/notifications/${NOTIF_ID_1}/acknowledge`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(403);
    await close();
  });
});
