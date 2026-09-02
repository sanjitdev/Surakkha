/**
 * `auditLogWriter.spec.ts` — Story 5.6.
 *
 * Unit tests for the v2 `AuditLogger` writer
 * (`packages/api/src/audit/auditLogWriter.ts`). Pins the
 * `AuditAction → { resource, resourceId }` mapping + the
 * swallow-and-log failure mode the spec promises. Mirrors the
 * `auditLogRepository.spec.ts` style (helper-focused unit tests,
 * no Express + no auth).
 *
 * Coverage (each I/O matrix row → at least one `it(...)`):
 *
 *   - WRITE_HAPPY: `audit.emit({ login_success, userId, outcome })`
 *     persists an `AuditLog` row with `actorUserId`, `resource:
 *     "Session"`, `resourceId: null` (the `login_success` map entry
 *     uses `resourceIdKey: "sessionId"`; absent context yields
 *     `resourceId: null`).
 *   - WRITE_NO_USER: `audit.emit({ logout })` (no `userId`) persists
 *     with `actorUserId: null`, `resource: "Other"`, `resourceId:
 *     null` per the resource-less default.
 *   - WRITE_INCIDENT_RESOURCE: `audit.emit({ incident_state_changed,
 *     context: { incidentId } })` persists with `resource:
 *     "Incident"`, `resourceId: incidentId`.
 *   - WRITE_DB_FAIL: `prisma.auditLog.create` rejects → the writer
 *     swallows + emits a `audit_log_write_failed` warn line. The
 *     warn payload MUST include `auditAction`, `outcome`,
 *     `actorUserId`, `resource`, AND `resourceId` so an SRE can
 *     recover the dropped row (F-5.6-D18).
 *   - WRITE_LOGOUT: explicit `logout` action → `resource: "Other"`,
 *     `resourceId: null`.
 *
 * The writer's `emit` is fire-and-forget (the v1 interface is
 * `(event) => void`) so each test uses a polling drain helper to
 * wait for the Prisma stub to observe the write (F-5.6-D16).
 */
import { type Logger } from "pino";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type AuditLogCreateClient,
  createAuditLogWriter,
  resolveResourceBinding,
  resolveResourceId,
} from "./auditLogWriter.js";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000002";

/**
 * Build a writable `Logger` spy. The `warn` sink is captured so the
 * `WRITE_DB_FAIL` test can assert the structured log payload.
 */
const buildSpyLogger = (): { logger: Logger; warns: unknown[] } => {
  const warns: unknown[] = [];
  const logger = {
    warn: (...args: unknown[]) => {
      warns.push(args);
    },
  } as unknown as Logger;
  return { logger, warns };
};

/**
 * Build a Prisma stub that records every `auditLog.create` call.
 * The stub is intentionally narrow — the writer only depends on
 * `auditLog.create`, so the test rig does not need to fabricate
 * a full `@prisma/client` instance.
 */
const buildCaptureClient = (
  onCreate?: () => Promise<unknown>,
): {
  client: AuditLogCreateClient;
  rows: Array<{
    actorUserId: string | null;
    auditAction: string;
    resource: string;
    resourceId: string | null;
    payload: unknown;
    outcome: string;
  }>;
} => {
  const rows: Array<{
    actorUserId: string | null;
    auditAction: string;
    resource: string;
    resourceId: string | null;
    payload: unknown;
    outcome: string;
  }> = [];
  const client: AuditLogCreateClient = {
    auditLog: {
      create: async (args) => {
        rows.push(args.data);
        if (onCreate !== undefined) return onCreate();
        return null;
      },
    },
  };
  return { client, rows };
};

/**
 * Poll the `sink.rows` array until `expected` rows have been
 * captured (or the 50-iteration cap trips). The writer's `emit`
 * is fire-and-forget, so the test rig yields the event loop via
 * `setImmediate` between checks (F-5.6-D16 — polling drain).
 */
const drain = async (sink: { rows: readonly unknown[] }, expected: number): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (sink.rows.length >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`drain timed out: expected ${expected} row(s), got ${sink.rows.length}`);
};

beforeEach(() => {
  // Each test owns its own logger / prisma sink; nothing global.
});

describe("Story 5.6 — auditLogWriter.createAuditLogWriter", () => {
  it("WRITE_HAPPY: persist AuditLog row with actorUserId + resource + payload", async () => {
    const { logger } = buildSpyLogger();
    const { client, rows } = buildCaptureClient();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => client,
      logger,
    });
    audit.emit({
      auditAction: "login_success",
      userId: ACTOR_ID,
      outcome: "success",
      context: { sessionId: "sess-1" },
    });
    await drain({ rows }, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      actorUserId: ACTOR_ID,
      auditAction: "login_success",
      resource: "Session",
      resourceId: "sess-1",
      payload: { sessionId: "sess-1" },
      outcome: "success",
    });
  });

  it("WRITE_NO_USER: no userId → actorUserId: null + resource: Other + resourceId: null", async () => {
    const { logger } = buildSpyLogger();
    const { client, rows } = buildCaptureClient();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => client,
      logger,
    });
    audit.emit({ auditAction: "logout", outcome: "success" });
    await drain({ rows }, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      actorUserId: null,
      auditAction: "logout",
      resource: "Other",
      resourceId: null,
      payload: {},
      outcome: "success",
    });
  });

  it("WRITE_INCIDENT_RESOURCE: context.incidentId → resource: Incident + resourceId populated", async () => {
    const { logger } = buildSpyLogger();
    const { client, rows } = buildCaptureClient();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => client,
      logger,
    });
    audit.emit({
      auditAction: "incident_state_changed",
      userId: ACTOR_ID,
      outcome: "success",
      context: { incidentId: INCIDENT_ID, from: "OPEN", to: "ACKNOWLEDGED" },
    });
    await drain({ rows }, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      actorUserId: ACTOR_ID,
      auditAction: "incident_state_changed",
      resource: "Incident",
      resourceId: INCIDENT_ID,
      payload: { incidentId: INCIDENT_ID, from: "OPEN", to: "ACKNOWLEDGED" },
      outcome: "success",
    });
  });

  it("WRITE_DB_FAIL: prisma.auditLog.create rejects → swallow + warn payload", async () => {
    const { logger, warns } = buildSpyLogger();
    const client: AuditLogCreateClient = {
      auditLog: {
        create: async () => {
          throw new Error("P2xxx prisma unreachable");
        },
      },
    };
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => client,
      logger,
    });
    audit.emit({
      auditAction: "incident_state_changed",
      userId: ACTOR_ID,
      outcome: "success",
      context: { incidentId: INCIDENT_ID },
    });
    // F-5.6-D16 — drain the warn array via setImmediate polling.
    const drainWarns = async (expected: number): Promise<void> => {
      for (let i = 0; i < 50; i += 1) {
        if (warns.length >= expected) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("drain timed out waiting for warn");
    };
    await drainWarns(1);
    expect(warns).toHaveLength(1);
    const warnArgs = warns[0] as [unknown, string];
    expect(warnArgs[1]).toBe("audit_log_write_failed");
    // F-5.6-D18 — the warn payload MUST include resource +
    // resourceId + actorUserId so the dropped row is recoverable
    // from the log line.
    const payload = warnArgs[0] as {
      auditAction: string;
      outcome: string;
      actorUserId: string | null;
      resource: string;
      resourceId: string | null;
      event: string;
    };
    expect(payload.auditAction).toBe("incident_state_changed");
    expect(payload.outcome).toBe("success");
    expect(payload.actorUserId).toBe(ACTOR_ID);
    expect(payload.resource).toBe("Incident");
    expect(payload.resourceId).toBe(INCIDENT_ID);
    expect(payload.event).toBe("audit_log_write_failed");
  });

  it("WRITE_LOGOUT: explicit logout action → resource: Other + resourceId: null", async () => {
    const { logger } = buildSpyLogger();
    const { client, rows } = buildCaptureClient();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => client,
      logger,
    });
    audit.emit({ auditAction: "logout", outcome: "success" });
    await drain({ rows }, 1);
    expect(rows[0]?.resource).toBe("Other");
    expect(rows[0]?.resourceId).toBeNull();
    expect(rows[0]?.actorUserId).toBeNull();
    expect(rows[0]?.auditAction).toBe("logout");
  });

  it("WRITE_RESOLVE_FAIL: resolvePrismaClient rejects → swallow + prisma_resolve warn (no row written)", async () => {
    // Pin the boot-outage code path that the spec pins
    // (transient resolver failure). The factory must NOT throw to
    // the caller; the warn payload's `reason: "prisma_resolve"`
    // lets SRE distinguish a missing Prisma client from a write
    // failure.
    const { logger, warns } = buildSpyLogger();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () => {
        throw new Error("DATABASE_URL unset");
      },
      logger,
    });
    audit.emit({
      auditAction: "login_success",
      userId: ACTOR_ID,
      outcome: "success",
    });
    const drainWarns = async (expected: number): Promise<void> => {
      for (let i = 0; i < 50; i += 1) {
        if (warns.length >= expected) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("drain timed out waiting for warn");
    };
    await drainWarns(1);
    const warnArgs = warns[0] as [unknown, string];
    const payload = warnArgs[0] as { reason: string; event: string };
    expect(payload.reason).toBe("prisma_resolve");
    expect(payload.event).toBe("audit_log_write_failed");
  });

  it("WRITE_RESOLVED_BUT_NO_AUDITLOG: client resolves but lacks auditLog.create → swallow + prisma_resolve warn (belt-and-braces)", async () => {
    // Pin the runtime guard added in loop-2 review — a future
    // Prisma client shape change (or a degraded stub) that
    // resolves successfully but lacks `auditLog.create` should
    // log a `prisma_resolve`-reasoned warn, NOT a misleading
    // `audit_create` warn.
    const { logger, warns } = buildSpyLogger();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () =>
        ({
          /* no auditLog */
        }) as unknown as AuditLogCreateClient,
      logger,
    });
    audit.emit({ auditAction: "logout", outcome: "success" });
    const drainWarns = async (expected: number): Promise<void> => {
      for (let i = 0; i < 50; i += 1) {
        if (warns.length >= expected) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error("drain timed out waiting for warn");
    };
    await drainWarns(1);
    const warnArgs = warns[0] as [unknown, string];
    const payload = warnArgs[0] as { reason: string };
    expect(payload.reason).toBe("prisma_resolve");
  });
});

describe("Story 5.6 — resolveResourceId (resource extraction helper)", () => {
  it("returns null when the action has no resourceIdKey (resource-less default)", () => {
    expect(resolveResourceId("logout", undefined)).toBeNull();
    expect(resolveResourceId("rbac_allowed", undefined)).toBeNull();
    expect(resolveResourceId("rbac_allowed", {})).toBeNull();
  });

  it("returns null when context is undefined", () => {
    expect(resolveResourceId("incident_state_changed", undefined)).toBeNull();
  });

  it("returns null when the context is missing the key", () => {
    expect(resolveResourceId("incident_state_changed", { from: "OPEN" })).toBeNull();
  });

  it("returns null when the value is not a string", () => {
    expect(resolveResourceId("incident_state_changed", { incidentId: 42 })).toBeNull();
    expect(resolveResourceId("incident_state_changed", { incidentId: null })).toBeNull();
  });

  it("F-5.6-D19: returns null when the string trims to empty (whitespace-only)", () => {
    expect(resolveResourceId("incident_state_changed", { incidentId: "   " })).toBeNull();
    expect(resolveResourceId("incident_state_changed", { incidentId: "\n\t" })).toBeNull();
  });

  it("returns the raw value when the trimmed string is non-empty (no trim mutation)", () => {
    // The writer does NOT trim the persisted value — a leading
    // or trailing space in a legitimate id stays intact. The
    // zero-length check is the only place `.trim()` appears.
    expect(resolveResourceId("incident_state_changed", { incidentId: " id " })).toBe(" id ");
  });
});

describe("Story 5.6 — resolveResourceBinding (resource tuple)", () => {
  it("returns the mapped resource + extracted resourceId", () => {
    expect(resolveResourceBinding("incident_state_changed", { incidentId: INCIDENT_ID })).toEqual({
      resource: "Incident",
      resourceId: INCIDENT_ID,
    });
  });

  it("returns the resource-less default for logout / rbac_allowed", () => {
    expect(resolveResourceBinding("logout", undefined)).toEqual({
      resource: "Other",
      resourceId: null,
    });
    expect(resolveResourceBinding("rbac_allowed", { subject: "Admin" })).toEqual({
      resource: "Other",
      resourceId: null,
    });
  });
});
