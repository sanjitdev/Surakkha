/**
 * router.spec.ts — Story 4.2 (HTTP router tests).
 *
 * Covers the 5 transition endpoints + the read endpoint:
 *   - 200 happy paths per verb.
 *   - 400 on bad UUIDs in the URL.
 *   - 400 on malformed bodies.
 *   - 401 when no bearer token.
 *   - 403 when RBAC denies.
 *   - 404 when the incident doesn't exist.
 *   - 409 when the state machine rejects.
 *   - 409 on optimistic-concurrency loser.
 *   - Optimistic observability log line on every successful transition.
 *   - Technician-only-mine ownership check on submit_result.
 *   - `notification:critical` write site fires on UNSAFE outcome.
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type IncidentEventRow,
  type IncidentRow,
  type IncidentStateRepository,
  OptimisticConcurrencyError,
} from "./incidentStateRepository.js";
import { buildIncidentsRouter } from "./router.js";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

const STRONG_SECRET = "x".repeat(64);

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const TECH_ID = "00000000-0000-4000-8000-00000000a003";
const OTHER_TECH_ID = "00000000-0000-4000-8000-00000000a007";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";

const INCIDENT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "22222222-2222-4222-8222-222222222222";

const tokenForRole = (role: "Admin" | "Operator" | "Technician" | "Viewer") => {
  const idForRole = {
    Admin: ADMIN_ID,
    Operator: OPERATOR_ID,
    Technician: TECH_ID,
    Viewer: VIEWER_ID,
  }[role];
  return issueAccessToken({ userId: idForRole, role }).token;
};

const tokenForTech = (techId: string) =>
  issueAccessToken({ userId: techId, role: "Technician" }).token;

const baseRow = (overrides: Partial<IncidentRow> = {}): IncidentRow => ({
  id: INCIDENT_ID,
  deviceId: DEVICE_ID,
  severity: "warning",
  metric: "tds_ppm",
  value: 312,
  openedAt: new Date("2026-08-27T00:00:00.000Z"),
  state: "OPEN",
  assigneeUserId: null,
  acknowledgedAt: null,
  resolvedAt: null,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
  ...overrides,
});

interface MockRepoOptions {
  readonly row: IncidentRow;
  readonly nextRow?: IncidentRow;
  readonly updateMany?: () => Promise<{ readonly count: number }>;
  readonly eventCreate?: (
    args: Parameters<IncidentStateRepository["incidentEvent"]["create"]>[0],
  ) => Promise<IncidentEventRow>;
  readonly notificationCreate?: (
    args: Parameters<IncidentStateRepository["notification"]["create"]>[0],
  ) => Promise<{ readonly id: string }>;
}

const makeMockRepo = (opts: MockRepoOptions): IncidentStateRepository => {
  const txMock: IncidentStateRepository = {
    incident: {
      // The post-update re-read in `applyTransition`. Tests that
      // care about the response body shape provide `nextRow`; the
      // default falls back to the pre-update row (so the response
      // shows the from-state for negative tests).
      findUnique: async () => opts.nextRow ?? opts.row,
      updateMany: opts.updateMany ?? (async () => ({ count: 1 })),
    },
    incidentEvent: {
      create:
        opts.eventCreate ??
        (async (args) => ({
          id: "event-aaaa-bbbb-cccc-dddddddddddd",
          incidentId: args.data.incidentId,
          actorUserId: args.data.actorUserId,
          type: args.data.type,
          payload: args.data.payload,
          createdAt: new Date("2026-08-27T01:00:00.000Z"),
        })),
    },
    notification: {
      create:
        opts.notificationCreate ?? (async () => ({ id: "notif-aaaa-bbbb-cccc-dddddddddddd" })),
    },
    $transaction: async <T>(cb: (tx: IncidentStateRepository) => Promise<T>): Promise<T> =>
      cb(txMock),
  };
  return {
    incident: {
      findUnique: async () => opts.row,
      updateMany: async () => ({ count: 1 }),
    },
    incidentEvent: txMock.incidentEvent,
    notification: txMock.notification,
    $transaction: txMock.$transaction,
  };
};

interface StartArgs {
  readonly row: IncidentRow;
  readonly nextRow?: IncidentRow;
  readonly audit?: AuditLogger;
  readonly broadcast?: Parameters<typeof buildIncidentsRouter>[0]["broadcast"];
  readonly updateMany?: MockRepoOptions["updateMany"];
  readonly eventCreate?: MockRepoOptions["eventCreate"];
  readonly notificationCreate?: MockRepoOptions["notificationCreate"];
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildIncidentsRouter({
      audit: args.audit ?? { emit: () => undefined },
      repo: makeMockRepo({
        row: args.row,
        nextRow: args.nextRow,
        updateMany: args.updateMany,
        eventCreate: args.eventCreate,
        notificationCreate: args.notificationCreate,
      }),
      broadcast: args.broadcast,
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

describe("Story 4.2 — POST /api/incidents/:id/acknowledge", () => {
  it("Admin can acknowledge an OPEN incident (200)", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      nextRow: baseRow({
        state: "ACKNOWLEDGED",
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("ACKNOWLEDGED");
    await close();
  });

  it("Operator can acknowledge an OPEN incident (200)", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      nextRow: baseRow({
        state: "ACKNOWLEDGED",
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    await close();
  });

  it("Technician CANNOT acknowledge (403)", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Technician")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("Viewer CANNOT acknowledge (403)", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Viewer")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("Returns 409 when the incident is not OPEN", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "ACKNOWLEDGED" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; from: string; attempted: string };
    expect(body.error).toBe("invalid_state_transition");
    expect(body.from).toBe("ACKNOWLEDGED");
    await close();
  });

  it("Returns 401 when no bearer token", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    await close();
  });

  it("Returns 400 on a malformed UUID", async () => {
    const { url, close } = await startApp({ row: baseRow() });
    const res = await fetch(`${url}/api/incidents/not-a-uuid/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("Emits incident_transition observability log on success (AC4)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      nextRow: baseRow({ state: "ACKNOWLEDGED" }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const observed = warnSpy.mock.calls
      .map((args) => args[0])
      .filter((arg): arg is string => typeof arg === "string")
      .find((line) => line.includes("incident_transition"));
    expect(observed).toBeDefined();
    warnSpy.mockRestore();
    await close();
  });
});

describe("Story 4.2 — POST /api/incidents/:id/assign", () => {
  it("Admin can assign an OPEN incident (200, payload echoes assignee)", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      nextRow: baseRow({
        state: "INSPECTING",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/assign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ assignee_user_id: TECH_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; assignee_user_id: string | null };
    expect(body.state).toBe("INSPECTING");
    expect(body.assignee_user_id).toBe(TECH_ID);
    await close();
  });

  it("Returns 400 when assignee_user_id is missing", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/assign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("Returns 400 when body has unknown fields (strict Zod)", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/assign`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ assignee_user_id: TECH_ID, extra: "bad" }),
    });
    expect(res.status).toBe(400);
    await close();
  });
});

describe("Story 4.2 — POST /api/incidents/:id/submit-result", () => {
  it("Assigned Technician can submit UNSAFE (200)", async () => {
    const { url, close } = await startApp({
      row: baseRow({
        state: "INSPECTING",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      nextRow: baseRow({
        state: "UNSAFE",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(TECH_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "UNSAFE" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("UNSAFE");
    await close();
  });

  it("Assigned Technician can submit SAFE (200)", async () => {
    const { url, close } = await startApp({
      row: baseRow({
        state: "INSPECTING",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      nextRow: baseRow({
        state: "SAFE",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(TECH_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "SAFE" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("SAFE");
    await close();
  });

  it("Unassigned Technician gets 403 (Technician-only-mine)", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "INSPECTING", assigneeUserId: TECH_ID }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(OTHER_TECH_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "SAFE" }),
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("Returns 400 when outcome is missing", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "INSPECTING", assigneeUserId: TECH_ID }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(TECH_ID)}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("Returns 409 when state is not INSPECTING", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "ACKNOWLEDGED", assigneeUserId: TECH_ID }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(TECH_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "SAFE" }),
    });
    expect(res.status).toBe(409);
    await close();
  });

  it("Admin CANNOT submit-result (403 — Technician only)", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "INSPECTING", assigneeUserId: TECH_ID }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "SAFE" }),
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("Emits notification:critical write site on UNSAFE outcome (Story 4.9)", async () => {
    const notificationSpy = vi.fn(async () => ({ id: "notif-aaaa" }));
    const { url, close } = await startApp({
      row: baseRow({
        state: "INSPECTING",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      nextRow: baseRow({
        state: "UNSAFE",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      notificationCreate: notificationSpy,
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(TECH_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "UNSAFE" }),
    });
    expect(res.status).toBe(200);
    expect(notificationSpy).toHaveBeenCalledTimes(1);
    const call = notificationSpy.mock.calls[0]?.[0];
    expect(call?.data.severity).toBe("critical");
    expect(call?.data.incidentId).toBe(INCIDENT_ID);
    await close();
  });

  it("Does NOT emit notification:critical on SAFE outcome", async () => {
    const notificationSpy = vi.fn(async () => ({ id: "notif-aaaa" }));
    const { url, close } = await startApp({
      row: baseRow({
        state: "INSPECTING",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      nextRow: baseRow({
        state: "SAFE",
        assigneeUserId: TECH_ID,
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
      notificationCreate: notificationSpy,
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/submit-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForTech(TECH_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ outcome: "SAFE" }),
    });
    expect(res.status).toBe(200);
    expect(notificationSpy).not.toHaveBeenCalled();
    await close();
  });
});

describe("Story 4.2 — POST /api/incidents/:id/resolve", () => {
  for (const fromState of ["SAFE", "UNSAFE", "MONITORING"] as const) {
    it(`${fromState} + resolve → 200 for Operator`, async () => {
      const { url, close } = await startApp({
        row: baseRow({ state: fromState, acknowledgedAt: new Date("2026-08-27T01:00:00.000Z") }),
        nextRow: baseRow({
          state: "RESOLVED",
          acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
          resolvedAt: new Date("2026-08-27T02:00:00.000Z"),
        }),
      });
      const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/resolve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenForRole("Operator")}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { state: string; resolved_at: string | null };
      expect(body.state).toBe("RESOLVED");
      expect(body.resolved_at).not.toBeNull();
      await close();
    });
  }

  it("OPEN + resolve → 409", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(409);
    await close();
  });

  it("Technician CANNOT resolve (403)", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "UNSAFE" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/resolve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Technician")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    await close();
  });
});

describe("Story 4.2 — POST /api/incidents/:id/reopen", () => {
  it("Admin can reopen a RESOLVED incident (200)", async () => {
    const { url, close } = await startApp({
      row: baseRow({
        state: "RESOLVED",
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
        resolvedAt: new Date("2026-08-27T02:00:00.000Z"),
      }),
      nextRow: baseRow({
        state: "OPEN",
        acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
        resolvedAt: new Date("2026-08-27T02:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/reopen`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe("OPEN");
    await close();
  });

  it("Operator CANNOT reopen (403)", async () => {
    const { url, close } = await startApp({
      row: baseRow({
        state: "RESOLVED",
        resolvedAt: new Date("2026-08-27T02:00:00.000Z"),
      }),
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/reopen`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
    await close();
  });

  it("OPEN + reopen → 409", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/reopen`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(409);
    await close();
  });
});

describe("Story 4.2 — optimistic concurrency (409 on loser's updateMany)", () => {
  it("Returns 409 with reason=concurrent_modification", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      updateMany: async () => {
        throw new OptimisticConcurrencyError(INCIDENT_ID);
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe("invalid_state_transition");
    expect(body.reason).toBe("concurrent_modification");
    await close();
  });

  it("Writes an invalid_transition_attempt event for the audit trail", async () => {
    const eventSpy = vi.fn(
      async (args: Parameters<IncidentStateRepository["incidentEvent"]["create"]>[0]) => ({
        id: "event-aaaa",
        incidentId: args.data.incidentId,
        actorUserId: args.data.actorUserId,
        type: args.data.type,
        payload: args.data.payload,
        createdAt: new Date(),
      }),
    );
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      updateMany: async () => {
        throw new OptimisticConcurrencyError(INCIDENT_ID);
      },
      eventCreate: eventSpy,
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(409);
    const invalidCalls = eventSpy.mock.calls.filter(
      (c) => c[0].data.type === "invalid_transition_attempt",
    );
    expect(invalidCalls).toHaveLength(1);
    await close();
  });
});

describe("Story 4.2 — GET /api/incidents/:id", () => {
  it("Operator can read any incident (200)", async () => {
    const { url, close } = await startApp({ row: baseRow({ state: "OPEN" }) });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; state: string };
    expect(body.id).toBe(INCIDENT_ID);
    expect(body.state).toBe("OPEN");
    await close();
  });

  it("Technician can read only if they are the assignee", async () => {
    const { url, close } = await startApp({
      row: baseRow({ state: "INSPECTING", assigneeUserId: TECH_ID }),
    });
    // Assigned: 200
    const assigned = await fetch(`${url}/api/incidents/${INCIDENT_ID}`, {
      headers: { Authorization: `Bearer ${tokenForTech(TECH_ID)}` },
    });
    expect(assigned.status).toBe(200);

    // Not assigned: 403
    const notAssigned = await fetch(`${url}/api/incidents/${INCIDENT_ID}`, {
      headers: { Authorization: `Bearer ${tokenForTech(OTHER_TECH_ID)}` },
    });
    expect(notAssigned.status).toBe(403);
    await close();
  });

  it("Returns 404 when the incident does not exist", async () => {
    const { close } = await startApp({ row: baseRow() });
    // Override the mock to return null for this test
    const app: Express = express();
    app.use(express.json({ limit: "32kb" }));
    app.use(authenticate);
    app.use(
      buildIncidentsRouter({
        audit: { emit: () => undefined },
        repo: {
          incident: {
            findUnique: async () => null,
            updateMany: async () => ({ count: 1 }),
          },
          incidentEvent: {
            create: async () => ({
              id: "e",
              incidentId: "",
              actorUserId: null,
              type: "acknowledge" as const,
              payload: {},
              createdAt: new Date(),
            }),
          },
          notification: { create: async () => ({ id: "n" }) },
          $transaction: async <T>(cb: (tx: IncidentStateRepository) => Promise<T>) =>
            cb({} as IncidentStateRepository),
        },
      }),
    );
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    const url404 = `http://127.0.0.1:${addr.port}`;
    const res = await fetch(`${url404}/api/incidents/${INCIDENT_ID}`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(404);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await close();
  });

  it("Returns 401 when no bearer token", async () => {
    const { url, close } = await startApp({ row: baseRow() });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}`);
    expect(res.status).toBe(401);
    await close();
  });
});

describe("Story 4.2 — broadcast emits incident:state_changed", () => {
  it("Emits incident:state_changed on every successful transition", async () => {
    const emitSpy = vi.fn();
    const { url, close } = await startApp({
      row: baseRow({ state: "OPEN" }),
      nextRow: baseRow({ state: "ACKNOWLEDGED" }),
      broadcast: {
        to: (_room: string) => ({
          emit: emitSpy,
        }),
      },
    });
    const res = await fetch(`${url}/api/incidents/${INCIDENT_ID}/acknowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const call = emitSpy.mock.calls.find((c) => c[0] === "incident:state_changed");
    expect(call).toBeDefined();
    await close();
  });
});
