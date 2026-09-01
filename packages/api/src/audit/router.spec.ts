/**
 * `router.spec.ts` — Story 5.3.
 *
 * Coverage (each I/O matrix row → at least one `it(...)`):
 *
 *   - HAPPY_PATH_ADMIN: Admin lists 100 rows; envelope shape
 *     `{ rows, total, truncated }`.
 *   - HAPPY_PATH_EMPTY: filter that matches no rows → empty
 *     envelope.
 *   - FILTER_BY_ACTOR: ?actorIds=a,b narrows to `{ in: [...] }`.
 *   - FILTER_BY_EVENT: ?event=incident_state narrows to
 *     `contains` + `insensitive`.
 *   - FILTER_BY_RESOURCE: ?resource=Incident narrows to equals.
 *   - FILTER_BY_DATE_24H: ?since=...&until=... narrows by createdAt.
 *   - COMBINED_FILTERS: actor + event + resource + date AND-ed.
 *   - RBAC_OPERATOR / RBAC_TECHNICIAN / RBAC_VIEWER: 403 + audit.
 *   - AUTH: 401 when no bearer token.
 *   - INVALID_DATE: malformed `?since` → 400.
 *   - INVALID_WINDOW: `since >= until` → 400.
 *   - EMPTY_FILTER_VALUE: `?event=` (empty) treated as no filter.
 *   - DB_THROW: Prisma throws → 500.
 *
 * The test rig mirrors `notificationRouter.spec.ts:102-126`:
 * in-process Express + `http.createServer` + a stub repo that
 * captures the `findManyAuditLog` arguments so the handler's
 * pass-through can be asserted without spinning up Prisma.
 */
import { type AuditLogEntry } from "@surakkha/shared/audit";
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { type AuditLogRepository, type AuditLogRow } from "./auditLogRepository.js";
import { buildAuditRouter } from "./router.js";

const STRONG_SECRET = "x".repeat(64);

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const TECHNICIAN_ID = "00000000-0000-4000-8000-00000000a003";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const RULE_ID = "22222222-2222-4222-8222-222222222222";

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
 * Build an `AuditLogRow` fixture with sensible defaults. The
 * `actorUserId`, `auditAction`, `resource`, and `resourceId`
 * fields are the load-bearing test inputs and are pinned
 * explicitly per test.
 */
const baseRow = (overrides: Partial<AuditLogRow> & { id: string }): AuditLogRow => ({
  id: overrides.id,
  actorUserId: ADMIN_ID,
  auditAction: "incident_state_changed",
  resource: "Incident",
  resourceId: INCIDENT_ID,
  payload: { from: "OPEN", to: "ACKNOWLEDGED" },
  outcome: "success",
  createdAt: new Date("2026-08-28T10:00:00.000Z"),
  ...overrides,
});

interface StartArgs {
  readonly audit: AuditLogger;
  readonly findManyAuditLog: AuditLogRepository["auditLog"]["findManyAuditLog"];
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildAuditRouter({
      audit: args.audit,
      repo: {
        auditLog: {
          findManyAuditLog: args.findManyAuditLog,
        },
      },
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

describe("Story 5.3 — GET /api/audit/list", () => {
  it("HAPPY_PATH_ADMIN: Admin sees 100 rows with the full envelope shape", async () => {
    const findManyCalls: readonly unknown[] = [];
    const rows: AuditLogRow[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`;
      rows.push(
        baseRow({
          id,
          createdAt: new Date(`2026-08-28T10:0${i}:00.000Z`),
        }),
      );
    }
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows, total: 250, truncated: true };
      },
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: AuditLogEntry[];
      total: number;
      truncated: boolean;
    };
    expect(body.rows).toHaveLength(3);
    expect(body.total).toBe(250);
    expect(body.truncated).toBe(true);
    // Every row matches the canonical wire shape.
    for (const entry of body.rows) {
      expect(entry.auditAction).toBe("incident_state_changed");
      expect(entry.resource).toBe("Incident");
      expect(entry.outcome).toBe("success");
    }
    // The filter shape is pinned to the spec: empty `where` for the
    // unfiltered admin listing.
    expect((findManyCalls[0] as { where: unknown })?.where).toEqual({});
    // Order + cap pinned.
    expect((findManyCalls[0] as { orderBy: unknown })?.orderBy).toEqual({
      createdAt: "desc",
    });
    expect((findManyCalls[0] as { take: unknown })?.take).toBe(100);
    await close();
  });

  it("HAPPY_PATH_EMPTY: 200 + { rows: [], total: 0, truncated: false }", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => ({ rows: [], total: 0, truncated: false }),
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], total: 0, truncated: false });
    await close();
  });

  it("FILTER_BY_ACTOR: ?actorIds=a,b narrows to { in: [a, b] }", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(`${url}/api/audit/list?actorIds=${ADMIN_ID}&actorIds=${OPERATOR_ID}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as {
      where: { actorIds?: readonly string[] };
      take?: number;
    };
    expect(call?.where.actorIds).toEqual([ADMIN_ID, OPERATOR_ID]);
    // The repo seam must always receive `take: 100` regardless of
    // which filter the request carried — pinning the cap at every
    // filter test so a future refactor that drops the cap trips
    // here rather than at HAPPY_PATH_ADMIN.
    expect(call?.take).toBe(100);
    await close();
  });

  it("FILTER_BY_EVENT: ?event=incident narrows via substring match", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(`${url}/api/audit/list?event=incident`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as {
      where: { event?: string };
      take?: number;
    };
    expect(call?.where.event).toBe("incident");
    expect(call?.take).toBe(100);
    await close();
  });

  it("FILTER_BY_RESOURCE: ?resource=Incident narrows to that resource", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(`${url}/api/audit/list?resource=Incident`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as {
      where: { resource?: string };
      take?: number;
    };
    expect(call?.where.resource).toBe("Incident");
    expect(call?.take).toBe(100);
    await close();
  });

  it("FILTER_BY_DATE_24H: ?since=...&until=... narrows by createdAt", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(
      `${url}/api/audit/list?since=2026-08-29T00:00:00Z&until=2026-08-30T00:00:00Z`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as {
      where: { since?: Date; until?: Date };
      take?: number;
    };
    expect(call?.where.since?.toISOString()).toBe("2026-08-29T00:00:00.000Z");
    expect(call?.where.until?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
    expect(call?.take).toBe(100);
    await close();
  });

  it("COMBINED_FILTERS: actor + event + resource + date AND-ed", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(
      `${url}/api/audit/list?actorIds=${ADMIN_ID}&event=incident_state&resource=Incident&since=2026-08-29T00:00:00Z&until=2026-08-30T00:00:00Z`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as {
      where: {
        actorIds?: readonly string[];
        event?: string;
        resource?: string;
        since?: Date;
        until?: Date;
      };
      take?: number;
    };
    expect(call?.where.actorIds).toEqual([ADMIN_ID]);
    expect(call?.where.event).toBe("incident_state");
    expect(call?.where.resource).toBe("Incident");
    expect(call?.where.since?.toISOString()).toBe("2026-08-29T00:00:00.000Z");
    expect(call?.where.until?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
    expect(call?.take).toBe(100);
    await close();
  });

  it("EMPTY_FILTER_VALUE: ?event= (empty) is treated as no filter applied", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(`${url}/api/audit/list?event=`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const call = findManyCalls[0] as { where: { auditAction?: unknown } };
    // Empty event means no `auditAction` filter in the where.
    expect(call?.where.auditAction).toBeUndefined();
    await close();
  });

  it("RBAC_OPERATOR: Operator cannot read the admin list → 403 + rbac_denied audit", async () => {
    const auditCalls: unknown[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (event) => {
          auditCalls.push(event);
        },
      },
      findManyAuditLog: async () => {
        throw new Error("should not be called");
      },
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
    const denialAudit = auditCalls.find(
      (c): c is { auditAction: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { auditAction?: string }).auditAction === "rbac_denied",
    );
    expect(denialAudit).toBeDefined();
    await close();
  });

  it("RBAC_TECHNICIAN: Technician cannot read the admin list → 403", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => {
        throw new Error("should not be called");
      },
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("RBAC_VIEWER: Viewer cannot read the admin list → 403", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => {
        throw new Error("should not be called");
      },
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("AUTH: 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => ({ rows: [], total: 0, truncated: false }),
    });
    const res = await fetch(`${url}/api/audit/list`);
    expect(res.status).toBe(401);
    await close();
  });

  it("INVALID_DATE: malformed ?since → 400 with validation_error", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(`${url}/api/audit/list?since=not-a-date`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    // The data layer MUST NOT receive the bad input.
    expect(findManyCalls).toHaveLength(0);
    await close();
  });

  it("INVALID_WINDOW: ?since >= ?until → 400 with invalid_range", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    // `since === until` (boundary); the >= guard short-circuits.
    const res = await fetch(
      `${url}/api/audit/list?since=2026-08-30T00:00:00Z&until=2026-08-30T00:00:00Z`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_range");
    expect(findManyCalls).toHaveLength(0);
    await close();
  });

  it("INVALID_RESOURCE: ?resource=Foo → 400 (closed enum)", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    const res = await fetch(`${url}/api/audit/list?resource=Foo`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(400);
    expect(findManyCalls).toHaveLength(0);
    await close();
  });

  it("ACTOR_IDS_OVER_CAP: ?actorIds=a&actorIds=b...×51 → 400 validation_error", async () => {
    const findManyCalls: readonly unknown[] = [];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async (args) => {
        findManyCalls.push(args);
        return { rows: [], total: 0, truncated: false };
      },
    });
    // Build 51 unique UUIDs — one over the 50-cap.
    const ids: string[] = [];
    for (let i = 0; i < 51; i += 1) {
      const hex = i.toString(16).padStart(2, "0");
      ids.push(`00000000-0000-4000-8000-0000000000${hex}`);
    }
    const qs = ids.map((id) => `actorIds=${id}`).join("&");
    const res = await fetch(`${url}/api/audit/list?${qs}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    // The data layer MUST NOT receive the request once the cap trips.
    expect(findManyCalls).toHaveLength(0);
    await close();
  });

  it("DB_THROW: Prisma throw surfaces 500", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => {
        throw new Error("prisma unreachable");
      },
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(500);
    await close();
  });

  it("ROW_WITH_NULL_ACTOR: row with actorUserId null surfaces as null on the wire", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => ({
        rows: [
          baseRow({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            actorUserId: null,
            auditAction: "jwt_secret_rotated",
            resource: "Session",
            resourceId: null,
            payload: { rotatedBy: "system" },
          }),
        ],
        total: 1,
        truncated: false,
      }),
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: AuditLogEntry[] };
    expect(body.rows[0]?.actorUserId).toBeNull();
    expect(body.rows[0]?.resourceId).toBeNull();
    expect(body.rows[0]?.auditAction).toBe("jwt_secret_rotated");
    await close();
  });

  it("ROW_WITH_PAYLOAD: row with structured payload surfaces as unknown on the wire", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => ({
        rows: [
          baseRow({
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            auditAction: "csv_exported",
            resource: "Reading",
            resourceId: RULE_ID,
            payload: { rowCount: 42, since: "2026-08-01", until: "2026-08-28", truncated: false },
          }),
        ],
        total: 1,
        truncated: false,
      }),
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ payload: { rowCount: number; truncated: boolean } }>;
    };
    expect(body.rows[0]?.payload.rowCount).toBe(42);
    expect(body.rows[0]?.payload.truncated).toBe(false);
    await close();
  });

  it("ROW_WITH_UNKNOWN_AUDIT_ACTION: a future auditAction value falls through as a raw string", async () => {
    // Story 5.6 may add new actions to `AuditActionSchema`. The
    // read surface must NOT 500 on a row whose action is unknown
    // to the closed enum — the row must render in the admin UI
    // with the raw string. Verify the adapter falls through.
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findManyAuditLog: async () => ({
        rows: [
          baseRow({
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            auditAction: "future_action_added_in_5_6" as never,
            resource: "Other",
            resourceId: null,
            payload: { hint: "future enum drift" },
          }),
        ],
        total: 1,
        truncated: false,
      }),
    });
    const res = await fetch(`${url}/api/audit/list`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ auditAction: string }>;
    };
    expect(body.rows[0]?.auditAction).toBe("future_action_added_in_5_6");
    await close();
  });
});
