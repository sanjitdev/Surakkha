/**
 * Story 3.5 — `GET /api/alerts` router tests.
 *
 * Mirrors `incidents/recentRouter.spec.ts:49` test rig
 * (`createServer` + `issueAccessToken` + `fetch`). Tests:
 *   1.  LIST_HAPPY_PATH (AC9)
 *   2.  LIST_DEFAULT_LIMIT (AC9)
 *   3.  LIST_CUSTOM_LIMIT (AC9)
 *   4.  LIST_LIMIT_OUT_OF_RANGE (AC9 + AC10)
 *   5.  LIST_LIMIT_NON_NUMERIC (AC9 + AC10)
 *   6.  LIST_LIMIT_FLOAT (AC10)
 *   7.  LIST_LIMIT_NEGATIVE (AC10)
 *   8.  LIST_FILTER_DEVICE (AC10)
 *   9.  LIST_FILTER_DEVICE_INVALID (AC10)
 *   10. LIST_FILTER_SEVERITY (AC10 — 3 separate test cases)
 *   11. LIST_FILTER_SEVERITY_INVALID (AC10)
 *   12. LIST_FILTER_ACK_FALSE (AC10)
 *   13. LIST_FILTER_ACK_TRUE (AC10)
 *   14. LIST_FILTER_ACK_INVALID (AC10)
 *   15. LIST_FILTER_CLEARED_TRUE (AC9 + AC10)
 *   16. LIST_FILTER_CLEARED_FALSE (AC10)
 *   17. LIST_FILTERS_COMPOSE (AC10)
 *   18. LIST_PAGINATION_FIRST (AC9)
 *   19. LIST_PAGINATION_NEXT (AC9)
 *   20. LIST_PAGINATION_CURSOR_INVALID (AC9)
 *   21. LIST_EMPTY_PAGE
 *   22. LIST_DEVICE_NOT_FOUND
 *   23. LIST_LINKED_ALERTS_PREDECESSOR (AC11)
 *   24. LIST_LINKED_ALERTS_NONE (AC11)
 *   25. LIST_LINKED_ALERTS_CLOSED (AC11)
 *   26. LIST_LINKED_ALERTS_BATCHED_MULTI_KEY (AC11)
 *   27. LIST_LINKED_ALERTS_BATCHED (AC11)
 *   28. LIST_LINKED_ALERTS_SLICE_CAP (AC11)
 *   29. LIST_VIEWER_OK (AC9 + AC13)
 *   30. LIST_TECHNICIAN_OK (AC9 + AC13)
 *   31. LIST_NO_TOKEN (AC9)
 *   32. LIST_DATA_LAYER_THROWS
 *   33. LIST_RESPONSE_SCHEMA_DRIFT
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertListResponseSchema } from "@surakkha/shared";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import {
  buildAlertListRouter,
  type AlertListDeps,
  type AlertListRepository,
} from "./listRouter.js";
import { encodeCursor } from "./list.js";

const STRONG_SECRET = "x".repeat(64);

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";
const TECHNICIAN_ID = "00000000-0000-4000-8000-00000000a003";

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";
const RULE_ID = "ab1c4f00-0000-4000-8000-000000000010";

const tokenForRole = (role: "Admin" | "Operator" | "Viewer" | "Technician"): string => {
  const userIds: Record<typeof role, string> = {
    Admin: ADMIN_ID,
    Operator: OPERATOR_ID,
    Viewer: VIEWER_ID,
    Technician: TECHNICIAN_ID,
  };
  return issueAccessToken({ userId: userIds[role], role }).token;
};

interface CapturedFindManyArgs {
  readonly where: Record<string, unknown>;
  readonly orderBy?: unknown;
  readonly take?: number;
  readonly select?: unknown;
}

interface StartArgs {
  readonly prisma: AlertListRepository;
  readonly audit?: AuditLogger;
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const deps: AlertListDeps = {
    audit: args.audit ?? { emit: () => undefined },
    prisma: args.prisma,
  };
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(buildAlertListRouter(deps));
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

/**
 * Build a `AlertListRepository` stub with the given canned responses
 * for the page query and the predecessor batched query. Captures
 * the `where` clause passed to the page query so tests can assert
 * the AND-composition of filters and the default `clearedAt: null`
 * clause. The first call to `findMany` is the page query; the
 * second call (if any) is the predecessor batched query.
 */
const buildPrismaStub = (params: {
  readonly pageRows?: ReadonlyArray<{
    readonly id: string;
    readonly deviceId: string;
    readonly ruleId: string;
    readonly severity: "info" | "warning" | "critical";
    readonly metric:
      | "ph"
      | "tds_ppm"
      | "turbidity_ntu"
      | "chlorine_ppm"
      | "temp_c"
      | "water_level_cm";
    readonly openedAt: Date;
    readonly clearedAt: Date | null;
    readonly acknowledgedAt: Date | null;
    readonly acknowledgedByUserId: string | null;
  }>;
  readonly predecessors?: ReadonlyArray<{
    readonly id: string;
    readonly openedAt: Date;
    readonly clearedAt: Date | null;
    readonly deviceId: string;
    readonly metric:
      | "ph"
      | "tds_ppm"
      | "turbidity_ntu"
      | "chlorine_ppm"
      | "temp_c"
      | "water_level_cm";
    readonly severity: "info" | "warning" | "critical";
  }>;
  readonly throws?: boolean;
}): AlertListRepository & {
  __getPageCalls(): readonly CapturedFindManyArgs[];
  __getPredecessorCalls(): readonly CapturedFindManyArgs[];
} => {
  const pageCalls: CapturedFindManyArgs[] = [];
  const predCalls: CapturedFindManyArgs[] = [];
  const stub: AlertListRepository & {
    __getPageCalls(): readonly CapturedFindManyArgs[];
    __getPredecessorCalls(): readonly CapturedFindManyArgs[];
  } = {
    alert: {
      findMany: (args) => {
        // Distinguish the two query shapes: the page query has
        // `select` with the wide column set; the predecessor query
        // has `OR` in the where clause.
        const a = args as { where?: { OR?: unknown }; select?: unknown };
        if (a.where?.OR !== undefined) {
          predCalls.push({
            where: a.where as Record<string, unknown>,
            orderBy: (args as { orderBy?: unknown }).orderBy,
            take: (args as { take?: number }).take,
            select: a.select,
          });
          return Promise.resolve(params.predecessors ?? []);
        }
        pageCalls.push({
          where: (args as { where?: Record<string, unknown> }).where ?? {},
          orderBy: (args as { orderBy?: unknown }).orderBy,
          take: (args as { take?: number }).take,
          select: (args as { select?: unknown }).select,
        });
        if (params.throws === true) {
          return Promise.reject(new Error("prisma unreachable"));
        }
        return Promise.resolve(params.pageRows ?? []);
      },
    },
    __getPageCalls: () => pageCalls,
    __getPredecessorCalls: () => predCalls,
  };
  return stub;
};

describe("Story 3.5 — GET /api/alerts", () => {
  it("LIST_HAPPY_PATH: Operator token, no query string → 200 + default clearedAt=null clause in WHERE", async () => {
    const stub = buildPrismaStub({
      pageRows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          deviceId: DEVICE_A,
          ruleId: RULE_ID,
          severity: "critical",
          metric: "tds_ppm",
          openedAt: new Date("2026-08-26T12:00:00.000Z"),
          clearedAt: null,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
        },
      ],
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: Array<{ id: string }>;
      next_cursor: string | null;
    };
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.next_cursor).toBeNull();
    // Default clearedAt=null clause is in the actual WHERE.
    const where = stub.__getPageCalls()[0]?.where;
    expect(where?.["clearedAt"]).toBeNull();
    await close();
  });

  it("LIST_DEFAULT_LIMIT: handler invoked with limit=10 when no query string is presented", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.take).toBe(10);
    await close();
  });

  it("LIST_CUSTOM_LIMIT: ?limit=5 → handler invoked with limit=5", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?limit=5`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.take).toBe(5);
    await close();
  });

  it("LIST_LIMIT_OUT_OF_RANGE: ?limit=51 → 400 validation_error", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?limit=51`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    expect(stub.__getPageCalls()).toHaveLength(0);
    await close();
  });

  it("LIST_LIMIT_NON_NUMERIC: ?limit=banana → 400 validation_error", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?limit=banana`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("LIST_LIMIT_FLOAT: ?limit=51.5 → 400 validation_error (z.coerce.number().int() rejects)", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?limit=51.5`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("LIST_LIMIT_NEGATIVE: ?limit=-5 → 400 validation_error", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?limit=-5`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("LIST_FILTER_DEVICE: ?deviceId=<uuid> → where.deviceId = <uuid>", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?deviceId=${DEVICE_A}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["deviceId"]).toBe(DEVICE_A);
    await close();
  });

  it("LIST_FILTER_DEVICE_INVALID: ?deviceId=not-a-uuid → 400 (no Prisma call)", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?deviceId=not-a-uuid`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    expect(stub.__getPageCalls()).toHaveLength(0);
    await close();
  });

  it("LIST_FILTER_SEVERITY: ?severity=critical → where.severity = 'critical'", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?severity=critical`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["severity"]).toBe("critical");
    await close();
  });

  it("LIST_FILTER_SEVERITY: ?severity=warning → where.severity = 'warning'", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?severity=warning`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["severity"]).toBe("warning");
    await close();
  });

  it("LIST_FILTER_SEVERITY: ?severity=info → where.severity = 'info'", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?severity=info`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["severity"]).toBe("info");
    await close();
  });

  it("LIST_FILTER_SEVERITY_INVALID: ?severity=CRITICAL → 400 (case-sensitive)", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?severity=CRITICAL`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    expect(stub.__getPageCalls()).toHaveLength(0);
    await close();
  });

  it("LIST_FILTER_SEVERITY_INVALID: ?severity=banana → 400", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?severity=banana`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("LIST_FILTER_ACK_FALSE: ?acknowledged=false → where.acknowledgedAt = null", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?acknowledged=false`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["acknowledgedAt"]).toBeNull();
    await close();
  });

  it("LIST_FILTER_ACK_TRUE: ?acknowledged=true → where.acknowledgedAt: { not: null }", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?acknowledged=true`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["acknowledgedAt"]).toEqual({ not: null });
    await close();
  });

  it("LIST_FILTER_ACK_INVALID: ?acknowledged=banana → 400 (NOT z.coerce.boolean())", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?acknowledged=banana`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    expect(stub.__getPageCalls()).toHaveLength(0);
    await close();
  });

  it("LIST_FILTER_CLEARED_TRUE: ?cleared=true → where.clearedAt: { not: null } (overrides default)", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?cleared=true`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["clearedAt"]).toEqual({ not: null });
    await close();
  });

  it("LIST_FILTER_CLEARED_FALSE: ?cleared=false → where.clearedAt = null (explicit override)", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?cleared=false`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(stub.__getPageCalls()[0]?.where["clearedAt"]).toBeNull();
    await close();
  });

  it("LIST_FILTERS_COMPOSE: all four filters → single where object with all four keys", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(
      `${url}/api/alerts?deviceId=${DEVICE_A}&severity=critical&acknowledged=false&cleared=false`,
      {
        headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
      },
    );
    expect(res.status).toBe(200);
    // SINGLE where call (NOT four separate calls).
    expect(stub.__getPageCalls()).toHaveLength(1);
    const where = stub.__getPageCalls()[0]?.where;
    expect(where?.["deviceId"]).toBe(DEVICE_A);
    expect(where?.["severity"]).toBe("critical");
    expect(where?.["acknowledgedAt"]).toBeNull();
    expect(where?.["clearedAt"]).toBeNull();
    await close();
  });

  it("LIST_PAGINATION_FIRST: no cursor → no cursor predicate in WHERE", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const where = stub.__getPageCalls()[0]?.where;
    expect(where?.["OR"]).toBeUndefined();
    await close();
  });

  it("LIST_PAGINATION_NEXT: ?cursor=<opaque> → cursor predicate in WHERE", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const opaque = encodeCursor({
      t: new Date("2026-08-26T12:00:00.000Z").getTime(),
      i: "11111111-1111-4111-8111-111111111111",
    });
    const res = await fetch(`${url}/api/alerts?cursor=${opaque}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const where = stub.__getPageCalls()[0]?.where;
    expect(where?.["OR"]).toBeDefined();
    await close();
  });

  it("LIST_PAGINATION_CURSOR_INVALID: ?cursor=banana → 400", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?cursor=banana`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    expect(stub.__getPageCalls()).toHaveLength(0);
    await close();
  });

  it("LIST_EMPTY_PAGE: no rows match → 200 + { alerts: [], next_cursor: null }", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alerts: [], next_cursor: null });
    await close();
  });

  it("LIST_DEVICE_NOT_FOUND: ?deviceId=<random-uuid-no-alerts> → 200 + empty page (NOT 404)", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?deviceId=22222222-2222-4222-8222-222222222222`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alerts: [], next_cursor: null });
    await close();
  });

  it("LIST_LINKED_ALERTS_PREDECESSOR: OPEN row gets predecessor rows in opened_at DESC; wrong-key predecessor excluded", async () => {
    const openRowId = "11111111-1111-4111-8111-111111111111";
    const closedPredecessorA = {
      id: "22222222-2222-4222-8222-222222222222",
      openedAt: new Date("2026-08-26T10:00:00.000Z"),
      clearedAt: new Date("2026-08-26T11:00:00.000Z"),
    };
    const closedPredecessorB = {
      id: "33333333-3333-4333-8333-333333333333",
      openedAt: new Date("2026-08-26T09:00:00.000Z"),
      clearedAt: new Date("2026-08-26T10:30:00.000Z"),
    };
    const stub = buildPrismaStub({
      pageRows: [
        {
          id: openRowId,
          deviceId: DEVICE_A,
          ruleId: RULE_ID,
          severity: "critical",
          metric: "tds_ppm",
          openedAt: new Date("2026-08-26T12:00:00.000Z"),
          clearedAt: null,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
        },
      ],
      predecessors: [
        // Order: openedAt DESC. A is more recent than B.
        { ...closedPredecessorA, deviceId: DEVICE_A, metric: "tds_ppm", severity: "critical" },
        { ...closedPredecessorB, deviceId: DEVICE_A, metric: "tds_ppm", severity: "critical" },
        // Wrong-key predecessor — same device, different metric.
        {
          id: "44444444-4444-4444-8444-444444444444",
          openedAt: new Date("2026-08-26T08:00:00.000Z"),
          clearedAt: new Date("2026-08-26T09:00:00.000Z"),
          deviceId: DEVICE_A,
          metric: "ph",
          severity: "critical",
        },
      ],
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: Array<{
        id: string;
        linked_alerts: Array<{ id: string }>;
      }>;
    };
    expect(body.alerts).toHaveLength(1);
    const linked = body.alerts[0]?.linked_alerts ?? [];
    // Only the same-key predecessors — wrong-key row excluded.
    expect(linked).toHaveLength(2);
    expect(linked[0]?.id).toBe(closedPredecessorA.id);
    expect(linked[1]?.id).toBe(closedPredecessorB.id);
    await close();
  });

  it("LIST_LINKED_ALERTS_NONE: OPEN row with no closed predecessors → linked_alerts = []", async () => {
    const stub = buildPrismaStub({
      pageRows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          deviceId: DEVICE_A,
          ruleId: RULE_ID,
          severity: "critical",
          metric: "tds_ppm",
          openedAt: new Date("2026-08-26T12:00:00.000Z"),
          clearedAt: null,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
        },
      ],
      predecessors: [],
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: Array<{ linked_alerts: unknown[] }>;
    };
    expect(body.alerts[0]?.linked_alerts).toEqual([]);
    await close();
  });

  it("LIST_LINKED_ALERTS_CLOSED: CLOSED page row → linked_alerts = [] (no further lookup)", async () => {
    const stub = buildPrismaStub({
      pageRows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          deviceId: DEVICE_A,
          ruleId: RULE_ID,
          severity: "critical",
          metric: "tds_ppm",
          openedAt: new Date("2026-08-26T12:00:00.000Z"),
          clearedAt: new Date("2026-08-26T13:00:00.000Z"),
          acknowledgedAt: null,
          acknowledgedByUserId: null,
        },
      ],
      // Predecessor list intentionally non-empty — the closed
      // page-row path skips the predecessor batched lookup entirely.
      predecessors: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          openedAt: new Date("2026-08-26T11:00:00.000Z"),
          clearedAt: new Date("2026-08-26T12:00:00.000Z"),
          deviceId: DEVICE_A,
          metric: "tds_ppm",
          severity: "critical",
        },
      ],
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts?cleared=true`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    // No predecessor batched call (closed page row → skip).
    expect(stub.__getPredecessorCalls()).toHaveLength(0);
    const body = (await res.json()) as {
      alerts: Array<{ linked_alerts: unknown[] }>;
    };
    expect(body.alerts[0]?.linked_alerts).toEqual([]);
    await close();
  });

  it("LIST_LINKED_ALERTS_BATCHED_MULTI_KEY: page rows span 3 distinct (deviceId, metric, severity) keys → batched call covers all 3 keys, per-key slice stays at 5", async () => {
    // Companion to LIST_LINKED_ALERTS_BATCHED. That test pins the
    // single-batched-call + OR-array-length contract for the trivial
    // case (all 10 page rows share ONE key). The real-world shape is
    // multi-key: a dashboard's main page spans multiple devices ×
    // metrics × severities. This test pins:
    //   - The OR-array still contains ONE entry per page row (3 here,
    //     not 3*5 or similar).
    //   - Predecessors are partitioned correctly by (deviceId,
    //     metric, severity) key — each page row's linked_alerts only
    //     contains predecessors matching ITS key.
    //   - The per-key slice cap of 5 still applies independently
    //     (key A has 7 predecessors → wire linked_alerts is 5; keys
    //     B and C have 2 and 1 predecessors → wire linked_alerts
    //     matches those counts).
    const rowA = {
      id: "11111111-1111-4111-8111-111111111111",
      deviceId: DEVICE_A,
      ruleId: RULE_ID,
      severity: "critical" as const,
      metric: "tds_ppm" as const,
      openedAt: new Date("2026-08-26T12:00:00.000Z"),
      clearedAt: null,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    };
    const rowB = {
      id: "22222222-2222-4222-8222-222222222222",
      deviceId: DEVICE_B,
      ruleId: RULE_ID,
      severity: "warning" as const,
      metric: "ph" as const,
      openedAt: new Date("2026-08-26T11:00:00.000Z"),
      clearedAt: null,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    };
    const rowC = {
      id: "33333333-3333-4333-8333-333333333333",
      deviceId: DEVICE_A,
      ruleId: RULE_ID,
      severity: "info" as const,
      metric: "tds_ppm" as const,
      openedAt: new Date("2026-08-26T10:00:00.000Z"),
      clearedAt: null,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    };
    const predecessors = [
      // Key A (DEVICE_A, tds_ppm, critical): 7 rows, slice → 5
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
        openedAt: new Date(`2026-08-26T${String(9 - i).padStart(2, "0")}:00:00.000Z`),
        clearedAt: new Date(`2026-08-26T${String(10 - i).padStart(2, "0")}:00:00.000Z`),
        deviceId: DEVICE_A,
        metric: "tds_ppm" as const,
        severity: "critical" as const,
      })),
      // Key B (DEVICE_B, ph, warning): 2 rows
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
        openedAt: new Date(`2026-08-26T${String(8 - i).padStart(2, "0")}:00:00.000Z`),
        clearedAt: new Date(`2026-08-26T${String(9 - i).padStart(2, "0")}:00:00.000Z`),
        deviceId: DEVICE_B,
        metric: "ph" as const,
        severity: "warning" as const,
      })),
      // Key C (DEVICE_A, tds_ppm, info): 1 row
      {
        id: "66666666-6666-4666-8666-666666666666",
        openedAt: new Date("2026-08-26T07:00:00.000Z"),
        clearedAt: new Date("2026-08-26T08:00:00.000Z"),
        deviceId: DEVICE_A,
        metric: "tds_ppm" as const,
        severity: "info" as const,
      },
      // Wrong-key noise (must NOT show up in any page row's
      // linked_alerts): DEVICE_A × ph × critical — overlaps with no
      // page row key.
      {
        id: "77777777-7777-4777-8777-777777777777",
        openedAt: new Date("2026-08-26T06:00:00.000Z"),
        clearedAt: new Date("2026-08-26T07:00:00.000Z"),
        deviceId: DEVICE_A,
        metric: "ph" as const,
        severity: "critical" as const,
      },
    ];
    const stub = buildPrismaStub({
      pageRows: [rowA, rowB, rowC],
      predecessors,
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    // Single batched call covering all 3 page-row keys.
    expect(stub.__getPredecessorCalls()).toHaveLength(1);
    const orArr = stub.__getPredecessorCalls()[0]?.where["OR"] as unknown[];
    expect(orArr).toHaveLength(3);
    // Per-key take = pageRowCount * PREDECESSOR_PER_ROW = 3 * 5 = 15.
    expect(stub.__getPredecessorCalls()[0]?.take).toBe(15);
    const body = (await res.json()) as {
      alerts: Array<{ id: string; linked_alerts: Array<{ id: string }> }>;
    };
    expect(body.alerts).toHaveLength(3);
    // Key A: 5 (capped from 7).
    const a = body.alerts.find((r) => r.id === rowA.id);
    expect(a?.linked_alerts).toHaveLength(5);
    expect(a?.linked_alerts.some((p) => p.id === "77777777-7777-4777-8777-777777777777")).toBe(
      false,
    );
    // Key B: 2 (uncapped, below the 5 cap).
    const b = body.alerts.find((r) => r.id === rowB.id);
    expect(b?.linked_alerts).toHaveLength(2);
    // Key C: 1 (uncapped, below the 5 cap).
    const c = body.alerts.find((r) => r.id === rowC.id);
    expect(c?.linked_alerts).toHaveLength(1);
    expect(c?.linked_alerts[0]?.id).toBe("66666666-6666-4666-8666-666666666666");
    await close();
  });

  it("LIST_LINKED_ALERTS_BATCHED: 10 OPEN rows × predecessors → ONE batched findMany call (NOT 10)", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      deviceId: DEVICE_A,
      ruleId: RULE_ID,
      severity: "critical" as const,
      metric: "tds_ppm" as const,
      openedAt: new Date(`2026-08-26T${String(12 - i).padStart(2, "0")}:00:00.000Z`),
      clearedAt: null,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
    }));
    const stub = buildPrismaStub({
      pageRows: rows,
      predecessors: [],
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    // SINGLE predecessor call (NOT one-per-row).
    expect(stub.__getPredecessorCalls()).toHaveLength(1);
    // The OR-clause has 10 entries (one per page row).
    const orArr = stub.__getPredecessorCalls()[0]?.where["OR"] as unknown[];
    expect(orArr).toHaveLength(10);
    await close();
  });

  it("LIST_LINKED_ALERTS_SLICE_CAP: OPEN row with 7 same-key predecessors → wire linked_alerts capped at 5", async () => {
    // The per-row slice in listRouter caps at PREDECESSOR_PER_ROW = 5.
    // Feed 7 predecessors (more than the cap) and assert the wire
    // response truncates to 5 (newest 5, opened_at DESC). This pins
    // the cap so a future refactor that bumps or removes the slice
    // is caught.
    const openRowId = "11111111-1111-4111-8111-111111111111";
    const predecessorRows = Array.from({ length: 7 }, (_, i) => ({
      id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
      openedAt: new Date(`2026-08-26T${String(10 - i).padStart(2, "0")}:00:00.000Z`),
      clearedAt: new Date(`2026-08-26T${String(11 - i).padStart(2, "0")}:00:00.000Z`),
      deviceId: DEVICE_A,
      metric: "tds_ppm" as const,
      severity: "critical" as const,
    }));
    const stub = buildPrismaStub({
      pageRows: [
        {
          id: openRowId,
          deviceId: DEVICE_A,
          ruleId: RULE_ID,
          severity: "critical",
          metric: "tds_ppm",
          openedAt: new Date("2026-08-26T12:00:00.000Z"),
          clearedAt: null,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
        },
      ],
      predecessors: predecessorRows,
    });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: Array<{
        linked_alerts: Array<{ id: string }>;
      }>;
    };
    // 7 predecessors in the stub, but the wire surface is capped at 5.
    expect(body.alerts[0]?.linked_alerts).toHaveLength(5);
    // Newest 5 (opened_at DESC); the FIRST returned by the batched
    // query is the most-recent (i=0 → 10:00:00), and we keep the
    // first 5 entries.
    expect(body.alerts[0]?.linked_alerts[0]?.id).toBe("22222222-2222-4222-8222-000000000000");
    expect(body.alerts[0]?.linked_alerts[4]?.id).toBe("22222222-2222-4222-8222-000000000004");
    await close();
  });

  it("LIST_VIEWER_OK: Viewer 200 + rbac_allowed audit row (the Alert.read matrix grants Viewer)", async () => {
    const auditEvents: Array<{ auditAction: string; outcome: string }> = [];
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({
      prisma: stub,
      audit: {
        emit: (e) => auditEvents.push({ auditAction: e.auditAction, outcome: e.outcome }),
      },
    });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(200);
    // The viewer's success path is `next()` after the authorize()
    // middleware writes an `rbac_allowed` audit row
    // (packages/api/src/middleware/authorize.ts:189). The test pins
    // both the absence of denial AND the presence of an allow-row
    // whose `outcome` field equals `"allow"` — operational dashboards
    // key off `outcome = allow` so a future drift that emits
    // `rbac_allowed` with `outcome = deny` would silently desync
    // those dashboards; this pin catches it.
    expect(auditEvents.some((e) => e.auditAction === "rbac_denied")).toBe(false);
    const allowEvent = auditEvents.find((e) => e.auditAction === "rbac_allowed");
    expect(allowEvent).toBeDefined();
    expect(allowEvent?.outcome).toBe("allow");
    await close();
  });

  it("LIST_TECHNICIAN_OK: Technician 200 + rbac_allowed audit row (same matrix grant as Viewer)", async () => {
    const auditEvents: Array<{ auditAction: string; outcome: string }> = [];
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({
      prisma: stub,
      audit: {
        emit: (e) => auditEvents.push({ auditAction: e.auditAction, outcome: e.outcome }),
      },
    });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(200);
    // Symmetric assertion with LIST_VIEWER_OK — pin both presence of
    // allow AND absence of denial AND the allow-row's `outcome`
    // field for downstream log readers (operational dashboards key
    // off `outcome = allow`).
    expect(auditEvents.some((e) => e.auditAction === "rbac_denied")).toBe(false);
    const allowEvent = auditEvents.find((e) => e.auditAction === "rbac_allowed");
    expect(allowEvent).toBeDefined();
    expect(allowEvent?.outcome).toBe("allow");
    await close();
  });

  it("LIST_NO_TOKEN: missing Authorization header → 401 unauthorized", async () => {
    const stub = buildPrismaStub({ pageRows: [] });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`);
    expect(res.status).toBe(401);
    expect(stub.__getPageCalls()).toHaveLength(0);
    await close();
  });

  it("LIST_DATA_LAYER_THROWS: listAlerts throws → 500 internal_error", async () => {
    const stub = buildPrismaStub({ throws: true });
    const { url, close } = await startApp({ prisma: stub });
    const res = await fetch(`${url}/api/alerts`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("internal_error");
    await close();
  });

  it("LIST_RESPONSE_SCHEMA_DRIFT: AlertListResponseSchema.safeParse fails → 500 internal_error", async () => {
    // Pinned by the safeParse guard at listRouter.ts. A future
    // schema drift could break the response shape; the guard must
    // surface 500 instead of throwing ZodError into Express's
    // default HTML-500 path. Stub the schema's safeParse to fail.
    const stub = buildPrismaStub({
      pageRows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          deviceId: DEVICE_A,
          ruleId: RULE_ID,
          severity: "critical",
          metric: "tds_ppm",
          openedAt: new Date("2026-08-26T12:00:00.000Z"),
          clearedAt: null,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
        },
      ],
    });
    const safeParseSpy = vi
      .spyOn(AlertListResponseSchema, "safeParse")
      .mockReturnValueOnce({ success: false, error: new Error("forced drift") } as never);
    try {
      const { url, close } = await startApp({ prisma: stub });
      const res = await fetch(`${url}/api/alerts`, {
        headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("internal_error");
      await close();
    } finally {
      safeParseSpy.mockRestore();
    }
  });
});
