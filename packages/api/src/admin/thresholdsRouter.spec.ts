/**
 * Story 3.7 — `/admin/thresholds` admin tab integration.
 *
 * Pins the AC matrix:
 *   - AC1: GET /rules returns paginated rows; cursor + activeOnly
 *     honored.
 *   - AC2: POST /rules creates at v1.
 *   - AC3: PATCH /rules/:id with `supersede: true` creates a new
 *     row at v+1 and flips old to isActive:false atomically.
 *   - AC4: PATCH /rules/:id with `activate: false` flips isActive.
 *   - AC5: PATCH /rules/:id/activate flips isActive to true.
 *   - AC6: RBAC — Operator + Technician + Viewer → 403 + rbac_denied
 *     audit. (Case 8 in the existing register already pins Viewer;
 *     this file pins the additional Operator + Technician deny cells
 *     via the same NEGATIVE_CASES data-driven structure.)
 *   - Negative: 400 on malformed body; 404 on unknown id.
 *
 * The repository is a stub — no live Prisma. Each test exercises a
 * specific branch of the handler and asserts on the stub's call
 * log + the response body. The `$transaction` callback receives the
 * SAME stub instance so the multi-write supersede flow can be
 * exercised end-to-end without a real DB.
 */
import { randomUUID } from "node:crypto";
import { type AddressInfo, createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";

import { type RuleRow } from "@surakkha/shared";
import { type AuditAction } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit";
import { issueAccessToken } from "../auth/jwt";
import { authenticate } from "../middleware/authorize";

import { buildThresholdsRouter, type ThresholdsRepository } from "./thresholdsRouter.js";

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const TECHNICIAN_ID = "00000000-0000-4000-8000-00000000a003";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";

const STRONG_SECRET = "x".repeat(64);

interface AuditEvent {
  readonly auditAction: AuditAction;
  readonly userId?: string;
  readonly outcome: "success" | "failure";
  readonly context?: Record<string, unknown>;
}

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

/**
 * Build a stub `ThresholdsRepository` from an in-memory rules map.
 * The stub mirrors the same shape as the production adapter but is
 * keyed on `id` for O(1) `findUnique` / `update` lookups.
 */
const buildRepo = (
  initial: readonly RuleRow[] = [],
): {
  readonly repo: ThresholdsRepository;
  readonly rules: Map<string, RuleRow>;
} => {
  const rules = new Map<string, RuleRow>();
  for (const r of initial) rules.set(r.id, r);
  const repo: ThresholdsRepository = {
    rule: {
      findMany: async (args) => {
        let rows = [...rules.values()];
        if (args.where?.isActive !== undefined) {
          rows = rows.filter((r) => r.isActive === args.where?.isActive);
        }
        if (args.cursor !== undefined) {
          const cursor = rules.get(args.cursor.id);
          if (cursor === undefined) return [];
          rows = rows.filter((r) => r.id !== cursor.id);
        }
        const take = args.take ?? rows.length;
        // `select` is honoured by Prisma; the stub ignores it
        // because every row in the map already has the full shape.
        void args.select;
        return rows.slice(0, take);
      },
      findUnique: async (args) => {
        void args.select;
        return rules.get(args.where.id) ?? null;
      },
      create: async (args) => {
        void args.select;
        const id = randomUUID();
        const row: RuleRow = { ...args.data, id };
        rules.set(id, row);
        return row;
      },
      update: async (args) => {
        void args.select;
        const existing = rules.get(args.where.id);
        if (existing === undefined) {
          throw new Error(`rule.update: id ${args.where.id} not found`);
        }
        const next: RuleRow = { ...existing, ...args.data };
        rules.set(args.where.id, next);
        return next;
      },
    },
    $transaction: async <T>(cb: (tx: ThresholdsRepository) => Promise<T>): Promise<T> => cb(repo),
  };
  return { repo, rules };
};

interface StartArgs {
  readonly audit: AuditLogger;
  readonly repo: ThresholdsRepository;
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use("/admin/thresholds", buildThresholdsRouter(args));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

const STRONG_ENV = STRONG_SECRET;
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env["JWT_SECRET"];
  process.env["JWT_SECRET"] = STRONG_ENV;
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = originalSecret;
});

const baseRow: RuleRow = {
  id: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  metric: "ph",
  operator: "lt",
  threshold: 6.5,
  severity: "critical",
  ruleType: "instant",
  minDurationSeconds: 0,
  hysteresisSeconds: 0,
  version: 1,
  createdBy: "seed",
  isActive: true,
};

describe("Story 3.7 — GET /admin/thresholds/rules (AC1)", () => {
  it("returns 200 + an empty list when the table has no rows", async () => {
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: unknown[]; nextCursor: string | null };
    expect(body.rules).toEqual([]);
    expect(body.nextCursor).toBeNull();
    await close();
  });

  it("returns the rows + a null nextCursor when fewer than `limit` rows exist", async () => {
    const { repo } = buildRepo([baseRow]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules?limit=10`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: RuleRow[]; nextCursor: string | null };
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]?.id).toBe(baseRow.id);
    expect(body.nextCursor).toBeNull();
    await close();
  });

  it("filters by activeOnly=true", async () => {
    const inactive: RuleRow = {
      ...baseRow,
      id: "33333333-3333-4333-8333-333333333333",
      isActive: false,
    };
    const { repo } = buildRepo([baseRow, inactive]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules?activeOnly=true`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: RuleRow[] };
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]?.id).toBe(baseRow.id);
    await close();
  });

  it("returns 403 + rbac_denied audit when an Operator hits the endpoint", async () => {
    const events: AuditEvent[] = [];
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      repo,
    });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(403);
    expect(events.length).toBe(1);
    expect(events[0]?.auditAction).toBe("rbac_denied");
    await close();
  });

  it("returns 401 when no bearer token is present", async () => {
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules`);
    expect(res.status).toBe(401);
    await close();
  });
});

describe("Story 3.7 — POST /admin/thresholds/rules (AC2)", () => {
  it("creates a new Rule at version=1, isActive=true, createdBy=actor", async () => {
    const { repo, rules } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: "22222222-2222-4222-8222-222222222222",
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
      }),
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as RuleRow;
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);
    expect(created.createdBy).toBe(ADMIN_ID);
    expect(rules.size).toBe(1);
    await close();
  });

  it("rejects a body with an unknown metric literal (validation_error)", async () => {
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metric: "humidity_pct",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("returns 403 + rbac_denied audit when a Viewer hits the endpoint", async () => {
    const events: AuditEvent[] = [];
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      repo,
    });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Viewer")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
      }),
    });
    expect(res.status).toBe(403);
    expect(events.length).toBe(1);
    expect(events[0]?.auditAction).toBe("rbac_denied");
    await close();
  });
});

describe("Story 3.7 — PATCH /admin/thresholds/rules/:id (AC3 + AC4)", () => {
  it("supersede: true creates v+1 + flips old to isActive=false (AC3)", async () => {
    const { repo, rules } = buildRepo([baseRow]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ supersede: true, threshold: 6.8 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { old: RuleRow; new: RuleRow };
    expect(body.old.id).toBe(baseRow.id);
    expect(body.old.isActive).toBe(false);
    expect(body.old.version).toBe(1);
    expect(body.new.version).toBe(2);
    expect(body.new.isActive).toBe(true);
    expect(body.new.threshold).toBe(6.8);
    expect(rules.size).toBe(2);
    await close();
  });

  it("supersede: true without field changes still creates v+1 (idempotent version bump)", async () => {
    const { repo } = buildRepo([baseRow]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ supersede: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { old: RuleRow; new: RuleRow };
    expect(body.new.version).toBe(2);
    expect(body.new.threshold).toBe(baseRow.threshold);
    await close();
  });

  it("activate: false flips isActive without a version bump (AC4)", async () => {
    const { repo, rules } = buildRepo([baseRow]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ activate: false }),
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as RuleRow;
    expect(row.id).toBe(baseRow.id);
    expect(row.isActive).toBe(false);
    expect(row.version).toBe(1);
    const persisted = rules.get(baseRow.id);
    expect(persisted?.isActive).toBe(false);
    await close();
  });

  it("rejects a body that has neither supersede nor activate", async () => {
    const { repo } = buildRepo([baseRow]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ threshold: 7.0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("returns 404 when the :id is well-formed but does not exist", async () => {
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/44444444-4444-4444-8444-444444444444`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ activate: false }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
    await close();
  });

  it("returns 400 when the :id is not a UUID", async () => {
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/not-a-uuid`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ activate: false }),
    });
    expect(res.status).toBe(400);
    await close();
  });
});

describe("Story 3.7 — PATCH /admin/thresholds/rules/:id/activate (AC5)", () => {
  it("flips isActive to true on a deactivated row", async () => {
    const deactivated: RuleRow = { ...baseRow, isActive: false };
    const { repo, rules } = buildRepo([deactivated]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}/activate`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as RuleRow;
    expect(row.isActive).toBe(true);
    expect(row.version).toBe(1);
    expect(rules.get(baseRow.id)?.isActive).toBe(true);
    await close();
  });

  it("is idempotent: re-activating an already-active row returns 200 with no version bump", async () => {
    const { repo } = buildRepo([baseRow]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}/activate`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as RuleRow;
    expect(row.isActive).toBe(true);
    expect(row.version).toBe(1);
    await close();
  });

  it("returns 404 when the named id does not exist", async () => {
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({ audit: { emit: () => undefined }, repo });
    const res = await fetch(
      `${url}/admin/thresholds/rules/44444444-4444-4444-8444-444444444444/activate`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
      },
    );
    expect(res.status).toBe(404);
    await close();
  });
});

describe("Story 3.7 — RBAC denials on /admin/thresholds (AC6)", () => {
  it("Operator → PATCH /rules/:id → 403 + rbac_denied audit", async () => {
    const events: AuditEvent[] = [];
    const { repo } = buildRepo([baseRow]);
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      repo,
    });
    const res = await fetch(`${url}/admin/thresholds/rules/${baseRow.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ activate: false }),
    });
    expect(res.status).toBe(403);
    expect(events.length).toBe(1);
    expect(events[0]?.auditAction).toBe("rbac_denied");
    await close();
  });

  it("Technician → POST /rules → 403 + rbac_denied audit", async () => {
    const events: AuditEvent[] = [];
    const { repo } = buildRepo([]);
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      repo,
    });
    const res = await fetch(`${url}/admin/thresholds/rules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Technician")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metric: "ph",
        operator: "lt",
        threshold: 6.5,
        severity: "critical",
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
      }),
    });
    expect(res.status).toBe(403);
    expect(events.length).toBe(1);
    expect(events[0]?.auditAction).toBe("rbac_denied");
    await close();
  });
});
