/**
 * Story 3.5 — `POST /api/alerts/:alert_id/acknowledge` router tests.
 *
 * Mirrors `incidents/recentRouter.spec.ts:49` test rig
 * (`createServer` + `issueAccessToken` + `fetch`). Tests:
 *   1. ACK_HAPPY_PATH (AC1, AC1b, AC1c)
 *   2. ACK_IDEMPOTENT (AC2)
 *   3. ACK_CLOSED_ALERT (CLOSED alert can still be ack'd)
 *   4. ACK_VIEWER_DENIED (AC3)
 *   5. ACK_TECHNICIAN_DENIED (AC4)
 *   6. ACK_ADMIN_OK (AC5)
 *   7. ACK_UNKNOWN_ID (AC6)
 *   8. ACK_NOT_UUID (AC7)
 *   9. ACK_NO_TOKEN (AC8)
 *   10. POST_COMMIT_EMIT_ORDERING (AC12)
 *   11. FIRST_ACK_EMITS_ONLY (AC12b)
 *   12. ACK_SAME_USER_REPLAY (AC2, AC12b)
 *   13. ACK_RACE_LOSER (AC1e)
 *   14. ACK_EMIT_THROWS (AC1d)
 *   15. CONSOLE_WARN_DISTINCTION (AC2)
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertAcknowledgeResponseSchema, AlertAcknowledgedEventSchema } from "@surakkha/shared";
import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import {
  buildAlertAcknowledgeRouter,
  type AlertAcknowledgeDeps,
  type AlertAcknowledgeRepository,
} from "./acknowledgeRouter.js";

const STRONG_SECRET = "x".repeat(64);

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";
const TECHNICIAN_ID = "00000000-0000-4000-8000-00000000a003";

const ALERT_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "9b1c4f00-0000-4000-8000-000000000001";

const tokenForRole = (role: "Admin" | "Operator" | "Viewer" | "Technician"): string => {
  const userIds: Record<typeof role, string> = {
    Admin: ADMIN_ID,
    Operator: OPERATOR_ID,
    Viewer: VIEWER_ID,
    Technician: TECHNICIAN_ID,
  };
  return issueAccessToken({ userId: userIds[role], role }).token;
};

interface CapturedEmit {
  readonly room: string;
  readonly event: string;
  readonly payload: unknown;
}

interface CapturedWarn {
  readonly msg: string;
}

interface StartArgs {
  readonly prisma: AlertAcknowledgeRepository;
  readonly audit?: AuditLogger;
  readonly broadcast?: {
    readonly emits: CapturedEmit[];
    readonly throwOnEmit?: boolean;
  };
  readonly now?: () => Date;
  readonly capturedWarns?: CapturedWarn[];
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  // Capture console.warn so CONSOLE_WARN_DISTINCTION can assert
  // `first=true` vs `first=false`. Other tests do not inspect
  // capturedWarns. We monkey-patch `console.warn` only when the
  // caller asked for it; the original is restored in `close()`.
  const { capturedWarns } = args;
  const originalWarn = console.warn;
  if (capturedWarns !== undefined) {
    console.warn = (msg: unknown, ...rest: unknown[]): void => {
      capturedWarns.push({ msg: typeof msg === "string" ? msg : String(msg) });
      // Mirror the original behavior — also forward extra args
      // (the router sometimes logs `, err` after the message).
      void rest;
    };
  }

  const emits: CapturedEmit[] = args.broadcast?.emits ?? [];
  const throwOnEmit = args.broadcast?.throwOnEmit ?? false;
  const broadcast = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown): unknown => {
        emits.push({ room, event, payload });
        if (throwOnEmit) throw new Error("forced emit failure");
        return undefined;
      },
    }),
  };

  const deps: AlertAcknowledgeDeps = {
    audit: args.audit ?? { emit: () => undefined },
    prisma: args.prisma,
    broadcast,
    now: args.now ?? (() => new Date("2026-08-26T12:00:00.000Z")),
  };

  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(buildAlertAcknowledgeRouter(deps));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      console.warn = originalWarn;
      server.close(() => resolve());
    });
  return { url, close };
};

beforeEach(() => {
  process.env["JWT_SECRET"] = STRONG_SECRET;
});

describe("Story 3.5 — POST /api/alerts/:alert_id/acknowledge", () => {
  it("ACK_HAPPY_PATH: Operator acks an OPEN alert → 200 + alert:acknowledged emitted + first=true", async () => {
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits },
      capturedWarns,
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alert_id: string;
      acknowledged_at: string;
      actor_user_id: string;
    };
    expect(body.alert_id).toBe(ALERT_ID);
    expect(body.acknowledged_at).toBe(fixedNow.toISOString());
    expect(body.actor_user_id).toBe(OPERATOR_ID);
    // Emit fires post-commit on `device:<deviceId>`.
    expect(emits).toHaveLength(1);
    expect(emits[0]?.room).toBe(`device:${DEVICE_ID}`);
    expect(emits[0]?.event).toBe("alert:acknowledged");
    expect(emits[0]?.payload).toEqual({
      alert_id: ALERT_ID,
      acknowledged_at: fixedNow.toISOString(),
      actor_user_id: OPERATOR_ID,
    });
    // Console log distinguishes first-state-change from retry.
    const firstLine = capturedWarns.find((w) => w.msg.includes(`alertId=${ALERT_ID}`));
    expect(firstLine?.msg).toContain("first=true");
    await close();
  });

  it("ACK_IDEMPOTENT: second Operator call returns 200 with original timestamp; emit count stays at 1; first=false", async () => {
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const originalAckAt = new Date("2026-08-26T11:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 0 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: originalAckAt,
            acknowledgedByUserId: ADMIN_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
      capturedWarns,
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      acknowledged_at: string;
      actor_user_id: string;
    };
    // Original timestamp + original actor preserved (not overwritten).
    expect(body.acknowledged_at).toBe(originalAckAt.toISOString());
    expect(body.actor_user_id).toBe(ADMIN_ID);
    // No second emit.
    expect(emits).toHaveLength(0);
    // Log line distinguishes from first-state-change.
    const reAckLine = capturedWarns.find((w) => w.msg.includes(`alertId=${ALERT_ID}`));
    expect(reAckLine?.msg).toContain("first=false");
    await close();
  });

  it("ACK_CLOSED_ALERT: Operator acks a closed alert (clearedAt IS NOT NULL) → 200 + emit fires", async () => {
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits },
      capturedWarns,
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(emits).toHaveLength(1);
    expect(emits[0]?.room).toBe(`device:${DEVICE_ID}`);
    await close();
  });

  it("ACK_VIEWER_DENIED: Viewer → 403 forbidden; no DB write; no emit", async () => {
    const auditEvents: Array<{ auditAction: string }> = [];
    const emits: CapturedEmit[] = [];
    let updateCalled = false;
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => {
          updateCalled = true;
          return Promise.resolve({ count: 0 });
        },
        findUnique: () => {
          throw new Error("findUnique should not be called");
        },
      },
    };
    const { url, close } = await startApp({
      prisma,
      audit: {
        emit: (e) => auditEvents.push({ auditAction: e.auditAction }),
      },
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.required_role).toBe("Operator");
    expect(updateCalled).toBe(false);
    expect(emits).toHaveLength(0);
    // rbac_denied audit row.
    expect(auditEvents.some((e) => e.auditAction === "rbac_denied")).toBe(true);
    await close();
  });

  it("ACK_TECHNICIAN_DENIED: Technician → 403 forbidden; no DB write; no emit", async () => {
    const auditEvents: Array<{ auditAction: string }> = [];
    const emits: CapturedEmit[] = [];
    let updateCalled = false;
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => {
          updateCalled = true;
          return Promise.resolve({ count: 0 });
        },
        findUnique: () => {
          throw new Error("findUnique should not be called");
        },
      },
    };
    const { url, close } = await startApp({
      prisma,
      audit: {
        emit: (e) => auditEvents.push({ auditAction: e.auditAction }),
      },
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(403);
    expect(updateCalled).toBe(false);
    expect(emits).toHaveLength(0);
    expect(auditEvents.some((e) => e.auditAction === "rbac_denied")).toBe(true);
    await close();
  });

  it("ACK_ADMIN_OK: Admin → 200 (same shape as Operator)", async () => {
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: ADMIN_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    expect(emits).toHaveLength(1);
    await close();
  });

  it("ACK_UNKNOWN_ID: alert does not exist → 404 not_found; no DB write; no emit", async () => {
    const emits: CapturedEmit[] = [];
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 0 }),
        findUnique: () => Promise.resolve(null),
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
    expect(emits).toHaveLength(0);
    await close();
  });

  it("ACK_NOT_UUID: non-UUID path segment → 400 validation_error; no DB write; no emit", async () => {
    const emits: CapturedEmit[] = [];
    let updateCalled = false;
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => {
          updateCalled = true;
          return Promise.resolve({ count: 0 });
        },
        findUnique: () => {
          throw new Error("findUnique should not be called");
        },
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/banana/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("validation_error");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(updateCalled).toBe(false);
    expect(emits).toHaveLength(0);
    await close();
  });

  it("ACK_NO_TOKEN: missing Authorization header → 401 unauthorized", async () => {
    const emits: CapturedEmit[] = [];
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () => Promise.resolve(null),
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
    await close();
  });

  it("POST_COMMIT_EMIT_ORDERING: stub captures; emit fires AFTER updateMany resolves", async () => {
    const emits: CapturedEmit[] = [];
    let updateManyResolved = false;
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () =>
          // Resolve AFTER setting the flag so the emit capture
          // below can observe the ordering.
          new Promise<{ count: number }>((resolve) => {
            setImmediate(() => {
              updateManyResolved = true;
              resolve({ count: 1 });
            });
          }),
        findUnique: () => {
          // At this point, updateMany has resolved — the findUnique
          // happens post-commit. The `expect` is a side effect that
          // proves the ordering, so the block body is required.
          expect(updateManyResolved).toBe(true);
          return Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          });
        },
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits },
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(emits).toHaveLength(1);
    expect(emits[0]?.event).toBe("alert:acknowledged");
    await close();
  });

  it("FIRST_ACK_EMITS_ONLY: Operator acks twice; emit count == 1", async () => {
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    let callIndex = 0;
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => {
          // First call: count=1 (first-ack). Second call: count=0
          // (re-ack — row is already acked).
          callIndex += 1;
          if (callIndex === 1) return Promise.resolve({ count: 1 });
          return Promise.resolve({ count: 0 });
        },
        findUnique: () => {
          if (callIndex === 1) {
            return Promise.resolve({
              id: ALERT_ID,
              deviceId: DEVICE_ID,
              acknowledgedAt: fixedNow,
              acknowledgedByUserId: OPERATOR_ID,
            });
          }
          // Subsequent calls: existing row state.
          return Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          });
        },
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits },
    });
    const operatorToken = tokenForRole("Operator");
    // First ack.
    const res1 = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(res1.status).toBe(200);
    expect(emits).toHaveLength(1);
    // Second ack (re-acknowledge).
    const res2 = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(res2.status).toBe(200);
    // Emit count UNCHANGED — first-ack-only.
    expect(emits).toHaveLength(1);
    await close();
  });

  it("ACK_DATA_CORRUPTION: row has acknowledgedAt set but acknowledgedByUserId is null → 500 internal_error (no silent fallback)", async () => {
    // Pinned by the explicit corruption guard at acknowledgeRouter.ts:299-305.
    // The compare-and-set predicate (`acknowledgedAt: null`) plus the
    // atomic `acknowledgedByUserId` write make this branch
    // structurally impossible under the schema — but if a buggy
    // migration ever drops the column constraint, this test ensures
    // the handler surfaces 500 instead of silently substituting the
    // requester's UUID (`?? actor` fallback that the previous cycle
    // removed).
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const originalAckAt = new Date("2026-08-26T11:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 0 }),
        findUnique: () =>
          // The corruption shape: acknowledgedAt is SET (so the row
          // is past the compare-and-set gate) but
          // acknowledgedByUserId is NULL (data corruption).
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: originalAckAt,
            acknowledgedByUserId: null,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
      capturedWarns,
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("internal_error");
    // No emit on the corruption path.
    expect(emits).toHaveLength(0);
    // No operator-triage log either (the schema-drift 500 path
    // intentionally skips the `first=true|false` log so a corrupt
    // row does not show up as a "successful" ack in the boot log).
    const triageLine = capturedWarns.find(
      (w) => w.msg.includes(`alertId=${ALERT_ID}`) && w.msg.includes("first="),
    );
    expect(triageLine).toBeUndefined();
    await close();
  });

  it("ACK_SAME_USER_REPLAY: Operator A acks; Operator B (different UUID) attempts ack → row stays at A's values; no second emit", async () => {
    const emits: CapturedEmit[] = [];
    const originalAckAt = new Date("2026-08-26T11:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 0 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: originalAckAt,
            acknowledgedByUserId: ADMIN_ID, // Original acker is Admin.
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
    });
    // Operator B attempts to ack.
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      acknowledged_at: string;
      actor_user_id: string;
    };
    // Row state preserved — Admin is still the actor.
    expect(body.acknowledged_at).toBe(originalAckAt.toISOString());
    expect(body.actor_user_id).toBe(ADMIN_ID);
    // No emit (re-ack by different user is still idempotent).
    expect(emits).toHaveLength(0);
    await close();
  });

  it("ACK_RACE_LOSER: two simultaneous updateMany calls → exactly ONE returns count === 1; total emits == 1", async () => {
    // Two concurrent calls. The stub's updateMany tracks call count
    // and returns count=1 for the FIRST call only (the compare-and-
    // set primitive's contract — only one writer wins the row's
    // tuple lock; the other sees count=0). The follow-up findUnique
    // returns the existing row's state (with the FIRST writer's
    // timestamp + actor).
    const emits: CapturedEmit[] = [];
    const firstAckAt = new Date("2026-08-26T12:00:00.000Z");
    let firstCallResolved = false;
    let callCount = 0;
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => {
          callCount += 1;
          if (callCount === 1) {
            return new Promise((resolve) => {
              setImmediate(() => {
                firstCallResolved = true;
                resolve({ count: 1 });
              });
            });
          }
          // Second call: row already updated by the first; the
          // compare-and-set predicate `acknowledgedAt: null` no
          // longer matches → count=0.
          // Block until the first call has resolved (true race).
          return new Promise((resolve) => {
            const tick = (): void => {
              if (firstCallResolved) resolve({ count: 0 });
              else setImmediate(tick);
            };
            tick();
          });
        },
        findUnique: () =>
          // The first call finds the row with its own writes; the
          // second call finds the row with the first caller's
          // writes (since the first call has now committed).
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: firstAckAt,
            acknowledgedByUserId: ADMIN_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      broadcast: { emits },
    });
    // Two concurrent acks from different operators.
    const [resA, resB] = await Promise.all([
      fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
      }),
      fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
      }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    // Total emits == 1 (first-ack-only).
    expect(emits).toHaveLength(1);
    await close();
  });

  it("ACK_EMIT_THROWS: BroadcastTarget.emit throws → response is still 200; console.warn logs the failure", async () => {
    const capturedWarns: CapturedWarn[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits: [], throwOnEmit: true },
      capturedWarns,
    });
    const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { acknowledged_at: string };
    // Response still carries the row's timestamp.
    expect(body.acknowledged_at).toBe(fixedNow.toISOString());
    // Emit failure logged.
    const emitFailLine = capturedWarns.find((w) => w.msg.includes("acknowledge emit failed"));
    expect(emitFailLine).toBeDefined();
    expect(emitFailLine?.msg).toContain(`alertId=${ALERT_ID}`);
    await close();
  });

  it("CONSOLE_WARN_DISTINCTION: first ack logs first=true; re-ack logs first=false", async () => {
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    let callIndex = 0;
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => {
          callIndex += 1;
          if (callIndex === 1) return Promise.resolve({ count: 1 });
          return Promise.resolve({ count: 0 });
        },
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          }),
      },
    };
    const { url, close } = await startApp({
      prisma,
      now: () => fixedNow,
      broadcast: { emits },
      capturedWarns,
    });
    const operatorToken = tokenForRole("Operator");
    // First ack.
    await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    // Re-ack.
    await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    // Exactly TWO log lines for this alert — one per request.
    const lines = capturedWarns.filter((w) => w.msg.includes(`alertId=${ALERT_ID}`));
    expect(lines).toHaveLength(2);
    expect(lines[0]?.msg).toContain("first=true");
    expect(lines[1]?.msg).toContain("first=false");
    await close();
  });

  it("ACK_RESPONSE_SCHEMA_DRIFT: AlertAcknowledgeResponseSchema.safeParse fails → 500 internal_error + no triage log", async () => {
    // Pinned by the safeParse guard at acknowledgeRouter.ts:375-382.
    // A future schema drift could break the response shape; the
    // guard must surface 500 instead of throwing ZodError into
    // Express's default HTML-500 path. We stub the schema's safeParse
    // to force failure and assert the 500 branch.
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          }),
      },
    };
    // Stub the response schema's safeParse to fail. The handler uses
    // `AlertAcknowledgeResponseSchema.safeParse(body)` at line 375;
    // force that call to return success: false.
    const safeParseSpy = vi
      .spyOn(AlertAcknowledgeResponseSchema, "safeParse")
      .mockReturnValueOnce({ success: false, error: new Error("forced drift") } as never);
    try {
      const { url, close } = await startApp({
        prisma,
        now: () => fixedNow,
        broadcast: { emits },
        capturedWarns,
      });
      const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("internal_error");
      // No emit on the schema-drift path.
      expect(emits).toHaveLength(0);
      // No operator-triage log either (the log fires AFTER the
      // safeParse check; a drift 500 should NOT leave a
      // `first=true` line claiming success).
      const triageLine = capturedWarns.find(
        (w) => w.msg.includes(`alertId=${ALERT_ID}`) && w.msg.includes("first="),
      );
      expect(triageLine).toBeUndefined();
      await close();
    } finally {
      safeParseSpy.mockRestore();
    }
  });

  it("ACK_EMIT_PAYLOAD_SCHEMA_DRIFT: AlertAcknowledgedEventSchema.safeParse fails → emit skipped + warn logged", async () => {
    // Pinned by the safeParse guard at acknowledgeRouter.ts:325-333.
    // A future event-schema drift could break the emit payload
    // shape; the guard must skip the emit (NOT send a malformed
    // payload over the socket) and log the schema-drift warning.
    const capturedWarns: CapturedWarn[] = [];
    const emits: CapturedEmit[] = [];
    const fixedNow = new Date("2026-08-26T12:00:00.000Z");
    const prisma: AlertAcknowledgeRepository = {
      alert: {
        updateMany: () => Promise.resolve({ count: 1 }),
        findUnique: () =>
          Promise.resolve({
            id: ALERT_ID,
            deviceId: DEVICE_ID,
            acknowledgedAt: fixedNow,
            acknowledgedByUserId: OPERATOR_ID,
          }),
      },
    };
    const safeParseSpy = vi
      .spyOn(AlertAcknowledgedEventSchema, "safeParse")
      .mockReturnValueOnce({ success: false, error: new Error("forced drift") } as never);
    try {
      const { url, close } = await startApp({
        prisma,
        now: () => fixedNow,
        broadcast: { emits },
        capturedWarns,
      });
      const res = await fetch(`${url}/api/alerts/${ALERT_ID}/acknowledge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
      });
      // Response is still 200 (the row was committed; the drift only
      // affects the socket emit, not the wire response).
      expect(res.status).toBe(200);
      // Emit was SKIPPED (no malformed payload over the socket).
      expect(emits).toHaveLength(0);
      // The schema-drift warn line is captured.
      const driftLine = capturedWarns.find((w) => w.msg.includes("ack emit schema drift"));
      expect(driftLine).toBeDefined();
      expect(driftLine?.msg).toContain(`alertId=${ALERT_ID}`);
      await close();
    } finally {
      safeParseSpy.mockRestore();
    }
  });
});
