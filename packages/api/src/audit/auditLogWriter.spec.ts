/**
 * `auditLogWriter.spec.ts` — Story 5.6.
 *
 * Unit tests for the v2 `AuditLogger` writer. Pins the
 * `AuditAction → { resource, resourceId }` mapping + the
 * swallow-and-log failure mode. Helper-focused, no Express.
 *
 * The writer's `emit` is fire-and-forget; each test uses
 * `drainWarns` / `drainRows` to wait for the stub to observe the
 * write (F-5.6-D16).
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  type AuditLogCreateClient,
  type AuditLoggerSink,
  createAuditLogWriter,
  resolveResourceBinding,
} from "./auditLogWriter.js";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000002";

/** Build a writable `warn`-sink spy for the structured-log assertions. */
const buildSpyLogger = (): { logger: AuditLoggerSink; warns: unknown[] } => {
  const warns: unknown[] = [];
  const logger: AuditLoggerSink = {
    warn: (...args: unknown[]) => {
      warns.push(args);
    },
  };
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
 * Poll `sink.rows` / `sink.warns` until `expected` items have
 * landed (F-5.6-D16). The writer's `emit` is fire-and-forget; the
 * test rig yields the event loop via `setImmediate` between
 * checks. 50-iteration cap trips if the write never lands.
 */
const pollFor = async (
  source: { readonly length: number },
  expected: number,
  label: string,
): Promise<void> => {
  for (let i = 0; i < 50; i += 1) {
    if (source.length >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${label} drain timed out: expected ${expected}, got ${source.length}`);
};

const drain = async (sink: { rows: readonly unknown[] }, expected: number): Promise<void> =>
  pollFor(sink.rows, expected, "rows");

const drainWarns = async (warns: readonly unknown[], expected: number): Promise<void> =>
  pollFor(warns, expected, "warns");

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
    await drainWarns(warns, 1);
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
    await drainWarns(warns, 1);
    const warnArgs = warns[0] as [unknown, string];
    const payload = warnArgs[0] as { reason: string; event: string };
    expect(payload.reason).toBe("prisma_resolve");
    expect(payload.event).toBe("audit_log_write_failed");
  });

  it("WRITE_RESOLVED_BUT_NO_AUDITLOG: client resolves but lacks auditLog.create → prisma.auditLog.create throws, swallowed as audit_log_write_failed", async () => {
    // The structural cast in `ensureClient` lets through a client
    // that lacks `auditLog.create`. The throw surfaces inside the
    // per-emit try/catch, which logs an `audit_log_write_failed`
    // warn (no `reason: "prisma_resolve"` — that field is reserved
    // for resolver-rejection, not write-rejection). This is the
    // regression guard against a future Prisma shape drift.
    const { logger, warns } = buildSpyLogger();
    const audit = createAuditLogWriter({
      resolvePrismaClient: async () =>
        ({
          /* no auditLog */
        }) as unknown as AuditLogCreateClient,
      logger,
    });
    audit.emit({ auditAction: "logout", outcome: "success" });
    await drainWarns(warns, 1);
    const warnArgs = warns[0] as [unknown, string];
    expect(warnArgs[1]).toBe("audit_log_write_failed");
    const payload = warnArgs[0] as { event: string; auditAction: string };
    expect(payload.event).toBe("audit_log_write_failed");
    expect(payload.auditAction).toBe("logout");
  });
});

describe("Story 5.6 — resolveResourceBinding", () => {
  const idOnly = (action: string, context: unknown): string | null =>
    resolveResourceBinding(
      action as Parameters<typeof resolveResourceBinding>[0],
      context as Record<string, unknown>,
    ).resourceId;

  it("returns the mapped resource + extracted resourceId", () => {
    expect(resolveResourceBinding("incident_state_changed", { incidentId: INCIDENT_ID })).toEqual({
      resource: "Incident",
      resourceId: INCIDENT_ID,
    });
  });

  it("returns resource-less default for actions with no resourceIdKey", () => {
    expect(resolveResourceBinding("logout", undefined)).toEqual({
      resource: "Other",
      resourceId: null,
    });
    expect(resolveResourceBinding("rbac_allowed", { subject: "Admin" })).toEqual({
      resource: "Other",
      resourceId: null,
    });
  });

  it("returns null when the key is missing from context", () => {
    expect(idOnly("incident_state_changed", { from: "OPEN" })).toBeNull();
  });

  it("returns null when the value is not a string (incl. number / null)", () => {
    expect(idOnly("incident_state_changed", { incidentId: 42 })).toBeNull();
    expect(idOnly("incident_state_changed", { incidentId: null })).toBeNull();
  });

  it("F-5.6-D19: collapses whitespace-only strings to null", () => {
    expect(idOnly("incident_state_changed", { incidentId: "   " })).toBeNull();
    expect(idOnly("incident_state_changed", { incidentId: "\n\t" })).toBeNull();
  });

  it("returns the raw value when the trimmed string is non-empty (no trim mutation)", () => {
    // The writer does NOT trim the persisted value — a leading
    // or trailing space in a legitimate id stays intact.
    expect(idOnly("incident_state_changed", { incidentId: " id " })).toBe(" id ");
  });
});
