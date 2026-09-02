/**
 * `audit.coverage.spec.ts` — Story 5.6.
 *
 * End-to-end coverage contract for the v2 `AuditLogger` writer
 * (`packages/api/src/audit/auditLogWriter.ts`). The spec is the
 * regression guard: every audited action in the api MUST land at
 * least one `AuditLog` row when invoked through its real router +
 * middleware. A future refactor that silently re-routes `audit.emit`
 * away from the Prisma writer will fail here.
 *
 * Each test stands up a fresh Express app that:
 *
 *   - mounts the REAL router under test (auth, incidents,
 *     thresholds, simulator, attachments)
 *   - uses the REAL `AuditLogger` v2 writer — but with the Prisma
 *     dependency replaced by an in-memory capture stub
 *     (`sink.rows`).
 *
 * The writer's `emit` is fire-and-forget (the v1 interface is
 * `(event) => void`), so each test drains `sink.rows` via a
 * polling helper that yields the event loop with `setImmediate`
 * until the expected number of rows has been captured (F-5.6-D16
 * — polling drain replaces the two-microtask `flush()` that was
 * unreliable when the Prisma write settled across several turns).
 *
 * Per the spec's Path A amendments:
 *
 *   - COVERAGE_INCIDENT_ACK asserts `rbac_allowed` (the success-
 *     path type-machine miss emits `invalid_state_transition`; the
 *     success path itself emits only the socket event today, so
 *     the RBAC middleware row is the regression guard).
 *   - COVERAGE_THRESHOLD_EDIT asserts `rbac_allowed` (the rule-
 *     upsert router does not emit a `rule_created` row today; the
 *     writer pipeline + Admin permit is the guard).
 *   - COVERAGE_SIMULATOR asserts `rbac_allowed` (the success path
 *     also writes `simulator_event`, but the only row the spec
 *     can pin per-request is the RBAC middleware row).
 *   - COVERAGE_ATTACHMENT asserts `sink.rows.length > 0` (any
 *     auditAction — proves the writer pipeline reached the
 *     attachment router; F-5.6-D15 — NOT the tautological
 *     `Array.isArray`).
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogCreateClient, createAuditLogWriter } from "../auditLogWriter.js";
import { buildAuthRouter } from "../../auth/router.js";
import { issueAccessToken } from "../../auth/jwt.js";
import { authenticate } from "../../middleware/authorize.js";
import { type IncidentStateRepository } from "../../incidents/incidentStateRepository.js";
import { buildIncidentsRouter } from "../../incidents/router.js";
import { buildThresholdsRouter, type ThresholdsRepository } from "../../admin/thresholdsRouter.js";
import {
  buildAdminSimulatorPublicRouter,
  buildAdminSimulatorRouter,
} from "../../admin/simulatorRouter.js";
import { type AttachmentRepository } from "../../attachments/attachmentRepository.js";
import { buildAttachmentRouter } from "../../attachments/attachmentRouter.js";

const STRONG_SECRET = "x".repeat(64);

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const TECHNICIAN_ID = "00000000-0000-4000-8000-00000000a003";
const OTHER_TECH_ID = "00000000-0000-4000-8000-00000000a007";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";

/**
 * Capture sink — a stand-in for the production Prisma `auditLog`
 * delegate that records every `create` call so the spec can
 * assert on the persisted row. Re-using the writer's own
 * `AuditLogCreateClient` interface keeps the seam identical to
 * production (F-5.6-D15 — the regression guard is a real
 * Prisma-shaped sink, not a stubbed writer).
 */
interface Sink {
  readonly rows: Array<{
    actorUserId: string | null;
    auditAction: string;
    resource: string;
    resourceId: string | null;
    payload: unknown;
    outcome: string;
  }>;
}

const buildSink = (): { client: AuditLogCreateClient; sink: Sink } => {
  const rows: Sink["rows"] = [];
  const client: AuditLogCreateClient = {
    auditLog: {
      create: async (args) => {
        rows.push(args.data);
        return null;
      },
    },
  };
  return { client, sink: { rows } };
};

/**
 * The v2 writer is lazy + fire-and-forget, so the test rig polls
 * `sink.rows` for `expected` rows, yielding the event loop with
 * `setImmediate` between checks (F-5.6-D16 — replaces the
 * unreliable two-microtask `flush()` from loop-1).
 */
const drain = async (sink: Sink, expected: number): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (sink.rows.length >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`drain timed out: expected ${expected} row(s), got ${sink.rows.length}`);
};

/**
 * Cooperative yield for "absence" assertions: give any in-flight
 * `audit.emit` IIFEs the same number of setImmediate ticks the
 * positive-path drain uses, but DO NOT require any rows to land.
 * Used by the no-enumeration-leak COVERAGE_LOGIN_FAIL test — the
 * contract is "no login_failure row", not "no rows at all", and
 * a fixed-window yield is the only way to assert absence without
 * a flaky time-based sleep.
 */
const drainZero = async (sink: Sink): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  void sink;
};

const tokenForRole = (role: "Admin" | "Operator" | "Technician" | "Viewer"): string =>
  issueAccessToken({
    userId:
      role === "Admin"
        ? ADMIN_ID
        : role === "Operator"
          ? OPERATOR_ID
          : role === "Technician"
            ? TECHNICIAN_ID
            : VIEWER_ID,
    role,
  }).token;

interface StartArgs {
  readonly mount: (
    app: Express,
    deps: { readonly audit: ReturnType<typeof createAuditLogWriter> },
  ) => void;
}

const startApp = async (
  args: StartArgs,
): Promise<{ url: string; close: () => Promise<void>; sink: Sink }> => {
  const { client, sink } = buildSink();
  // Silent logger — the writer's failure-path log line is asserted
  // directly in `auditLogWriter.spec.ts` (the unit suite); this
  // spec focuses on the happy-path row persistence.
  const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
  };
  const audit = createAuditLogWriter({
    resolvePrismaClient: async () => client,
    logger: silentLogger as never,
  });
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(buildAdminSimulatorPublicRouter());
  app.use("/auth", buildAuthRouter({ audit }));
  app.use(authenticate);
  args.mount(app, { audit });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close, sink };
};

/**
 * Build an `IncidentStateRepository` stub that always returns the
 * OPEN incident the tests expect. Mirrors the pattern from
 * `incidents/router.spec.ts` `makeMockRepo` — the outer
 * `findUnique` returns `row`; the tx-callback `findUnique` returns
 * `nextRow` (the post-update re-read inside `applyTransition`).
 */
const buildIncidentRepo = (
  opts: {
    readonly row?: { readonly state: string; readonly assigneeUserId?: string | null };
    readonly nextRow?: { readonly state: string; readonly assigneeUserId?: string | null };
  } = {},
): IncidentStateRepository => {
  const baseRow = {
    id: INCIDENT_ID,
    deviceId: DEVICE_ID,
    severity: "warning" as const,
    metric: "tds_ppm",
    value: 312,
    openedAt: new Date("2026-08-27T00:00:00.000Z"),
    state: "OPEN" as const,
    assigneeUserId: null,
    acknowledgedAt: null,
    resolvedAt: null,
    updatedAt: new Date("2026-08-27T00:00:00.000Z"),
  };
  const row = { ...baseRow, ...(opts.row ?? {}) };
  const nextRow = { ...baseRow, ...(opts.nextRow ?? {}) };
  const txMock: IncidentStateRepository = {
    incident: {
      findUnique: async () => nextRow,
      findMany: async () => [],
      updateMany: async () => ({ count: 1 }),
    },
    incidentEvent: {
      create: async (args) => ({
        id: "event-aaaa-bbbb-cccc-dddddddddddd",
        incidentId: args.data.incidentId,
        actorUserId: args.data.actorUserId,
        type: args.data.type,
        payload: args.data.payload,
        createdAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      findMany: async () => [],
    },
    notification: {
      create: async () => ({ id: "notif-aaaa-bbbb-cccc-dddddddddddd" }),
    },
    $transaction: async <T>(cb: (tx: IncidentStateRepository) => Promise<T>): Promise<T> =>
      cb(txMock),
  };
  return {
    incident: {
      findUnique: async () => row,
      findMany: async () => [],
      updateMany: async () => ({ count: 1 }),
    },
    incidentEvent: txMock.incidentEvent,
    notification: txMock.notification,
    $transaction: txMock.$transaction,
  };
};

const emptyThresholdsRepo = (): ThresholdsRepository => ({
  rule: {
    findMany: async () => [],
    findUnique: async () => null,
    create: async () => {
      throw new Error("not used");
    },
    update: async () => {
      throw new Error("not used");
    },
  },
  $transaction: async <T>(cb: (tx: ThresholdsRepository) => Promise<T>): Promise<T> =>
    cb(emptyThresholdsRepo()),
});

const emptyAttachmentRepo = (): AttachmentRepository => ({
  attachment: {
    create: async () => {
      throw new Error("not used");
    },
    findMany: async () => [],
    findUnique: async () => null,
    delete: async () => {
      throw new Error("not used");
    },
  },
});

beforeEach(() => {
  process.env["JWT_SECRET"] = STRONG_SECRET;
});

describe("Story 5.6 — coverage (audit writer reaches every audited action)", () => {
  it("COVERAGE_LOGIN: POST /auth/login → one AuditLog row with auditAction login_success", async () => {
    const { url, close, sink } = await startApp({
      mount: () => undefined,
    });
    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "operator@surakkha.test", password: "demo-operator" }),
    });
    expect(res.status).toBe(200);
    await drain(sink, 1);
    const loginRow = sink.rows.find((r) => r.auditAction === "login_success");
    expect(loginRow).toBeDefined();
    expect(loginRow?.actorUserId).toBe(OPERATOR_ID);
    expect(loginRow?.outcome).toBe("success");
    await close();
  });

  it("COVERAGE_LOGIN_FAIL: wrong password → NO login_failure audit row (no enumeration leak)", async () => {
    // Story 1.4 AC — a failed login must not produce a
    // `login_failure` audit row (the audit list would let an
    // attacker enumerate valid emails by probing logins and
    // watching the count). The auth router doesn't emit on the
    // failure branch; this spec pins that behaviour.
    const { url, close, sink } = await startApp({
      mount: () => undefined,
    });
    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "operator@surakkha.test", password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    // Yield the event loop so any incidental emit (e.g.,
    // RBAC-middleware noise) gets a chance to land BEFORE the
    // assertion. The contract is "no login_failure row exists"
    // — we don't assert that no rows exist at all.
    await drainZero(sink);
    const failureRows = sink.rows.filter((r) => r.auditAction === "login_failure");
    expect(failureRows).toHaveLength(0);
    await close();
  });

  it("COVERAGE_RBAC_DENIED (operator hits admin route): 403 + rbac_denied audit row", async () => {
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        app.use("/admin/thresholds", buildThresholdsRouter({ audit, repo: emptyThresholdsRepo() }));
      },
    });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(403);
    await drain(sink, 1);
    const denialRow = sink.rows.find((r) => r.auditAction === "rbac_denied");
    expect(denialRow).toBeDefined();
    expect(denialRow?.outcome).toBe("failure");
    expect(denialRow?.actorUserId).toBe(OPERATOR_ID);
    await close();
  });

  it("COVERAGE_RBAC_DENIED (technician blocked from another's incident): 403 + rbac_denied audit row", async () => {
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        const baseRepo = buildIncidentRepo();
        // Override the outer findUnique so the read handler
        // returns an incident assigned to a DIFFERENT technician.
        const repo: IncidentStateRepository = {
          ...baseRepo,
          incident: {
            ...baseRepo.incident,
            findUnique: async () => ({
              id: INCIDENT_ID,
              deviceId: DEVICE_ID,
              severity: "warning",
              metric: "tds_ppm",
              value: 312,
              openedAt: new Date("2026-08-27T00:00:00.000Z"),
              state: "OPEN",
              assigneeUserId: OTHER_TECH_ID,
              acknowledgedAt: null,
              resolvedAt: null,
              updatedAt: new Date("2026-08-27T00:00:00.000Z"),
            }),
          },
        };
        app.use(
          buildIncidentsRouter({
            audit,
            repo,
            broadcast: { to: () => ({ emit: () => undefined }) },
          }),
        );
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(403);
    await drain(sink, 1);
    const denialRow = sink.rows.find((r) => r.auditAction === "rbac_denied");
    expect(denialRow).toBeDefined();
    expect(denialRow?.actorUserId).toBe(TECHNICIAN_ID);
    await close();
  });

  it("COVERAGE_RBAC_ALLOWED (admin reads thresholds): rbac_allowed audit row from middleware", async () => {
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        app.use("/admin/thresholds", buildThresholdsRouter({ audit, repo: emptyThresholdsRepo() }));
      },
    });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    await drain(sink, 1);
    const allowRow = sink.rows.find((r) => r.auditAction === "rbac_allowed");
    expect(allowRow).toBeDefined();
    expect(allowRow?.outcome).toBe("allow");
    expect(allowRow?.actorUserId).toBe(ADMIN_ID);
    await close();
  });

  it("COVERAGE_INCIDENT_ACK: Operator posts acknowledge → rbac_allowed audit row (Path A amendment)", async () => {
    // Per the spec's Path A amendment, the success path of the
    // acknowledge transition does NOT emit `incident_state_changed`
    // today — only the socket event + (on type-machine miss) the
    // `invalid_state_transition` audit. The regression guard is
    // the `rbac_allowed` row from the middleware.
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        app.use(
          buildIncidentsRouter({
            audit,
            repo: buildIncidentRepo({ nextRow: { state: "ACKNOWLEDGED" } }),
            broadcast: { to: () => ({ emit: () => undefined }) },
          }),
        );
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    await drain(sink, 1);
    const allowRow = sink.rows.find((r) => r.auditAction === "rbac_allowed");
    expect(allowRow).toBeDefined();
    expect(allowRow?.actorUserId).toBe(OPERATOR_ID);
    await close();
  });

  it("COVERAGE_THRESHOLD_EDIT: Admin POSTs rule → rbac_allowed audit row (Path A amendment)", async () => {
    // Per Path A — the rule-upsert router does NOT emit a
    // `rule_created` row today. The regression guard is the
    // `rbac_allowed` row from the RBAC middleware. The body
    // passes Zod validation; the stub repo then throws to drive
    // a 500 path (the audit row lands BEFORE the create call).
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        app.use("/admin/thresholds", buildThresholdsRouter({ audit, repo: emptyThresholdsRepo() }));
      },
    });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        metric: "tds_ppm",
        operator: "gt",
        threshold: 350,
        severity: "warning",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
      }),
    });
    // 500 from the stub repo throwing on `create`. The audit row
    // lands BEFORE the create call (the middleware precedes the
    // handler), so the drain finds it regardless of the 500.
    expect(res.status).toBe(500);
    await drain(sink, 1);
    const allowRow = sink.rows.find((r) => r.auditAction === "rbac_allowed");
    expect(allowRow).toBeDefined();
    expect(allowRow?.actorUserId).toBe(ADMIN_ID);
    await close();
  });

  it("COVERAGE_SIMULATOR: Admin POSTs scenario → rbac_allowed audit row (Path A amendment)", async () => {
    // Per Path A — the simulator success path emits
    // `simulator_event` ONLY when the outbound call succeeds;
    // when `SIMULATOR_SECRET` is unset (test default), the route
    // returns 503 and only the RBAC middleware row lands.
    process.env["SIMULATOR_SECRET"] = undefined;
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        app.use(
          "/admin/simulator",
          buildAdminSimulatorRouter({
            audit,
            listDevices: async () => [{ id: DEVICE_A, name: "D1", scenario: "Normal" }],
          }),
        );
      },
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(503);
    await drain(sink, 1);
    const allowRow = sink.rows.find((r) => r.auditAction === "rbac_allowed");
    expect(allowRow).toBeDefined();
    expect(allowRow?.actorUserId).toBe(ADMIN_ID);
    await close();
  });

  it("COVERAGE_ATTACHMENT: Admin POSTs attachment → at least one AuditLog row exists (F-5.6-D15)", async () => {
    // F-5.6-D15 — assert the sink received at least one row
    // (any auditAction). Proves the writer pipeline reached the
    // attachment router; does NOT pin a specific auditAction
    // because the production `attachmentRouter` does not emit
    // `attachment_added` today (Path A amendment). The
    // `rbac_allowed` row from the middleware is the natural
    // regression guard.
    const { url, close, sink } = await startApp({
      mount: (app, { audit }) => {
        const repo: AttachmentRepository = {
          ...emptyAttachmentRepo(),
          attachment: {
            ...emptyAttachmentRepo().attachment,
            create: async (args) => ({
              id: "44444444-4444-4444-8444-444444444444",
              incidentId: args.data.incidentId,
              url: args.data.url,
              label: args.data.label ?? null,
              mime: args.data.mime ?? null,
              uploadedByUserId: args.data.uploadedByUserId ?? null,
              createdAt: new Date("2026-08-27T01:00:00.000Z"),
            }),
          },
        };
        app.use(
          buildAttachmentRouter({
            audit,
            repo,
            incidentFindUnique: async () => null,
          }),
        );
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com/photo.png", label: "photo" }),
    });
    expect(res.status).toBe(201);
    await drain(sink, 1);
    // F-5.6-D15 — assert the row landed (NOT the tautological
    // `Array.isArray(sink.rows)`).
    expect(sink.rows.length).toBeGreaterThan(0);
    await close();
  });

  it("COVERAGE_LOGOUT: explicit logout emit → AuditLog row with resource: Other", async () => {
    // logout has no router today; drive the writer directly via
    // a public test helper. The regression guard is the row
    // shape — `resource: "Other"`, `resourceId: null`,
    // `actorUserId: null` (the resource-less default).
    const { client, sink } = buildSink();
    const silentLogger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
    };
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => client,
      logger: silentLogger as never,
    });
    audit.emit({ auditAction: "logout", outcome: "success" });
    await drain(sink, 1);
    expect(sink.rows[0]).toEqual({
      actorUserId: null,
      auditAction: "logout",
      resource: "Other",
      resourceId: null,
      payload: {},
      outcome: "success",
    });
  });
});
