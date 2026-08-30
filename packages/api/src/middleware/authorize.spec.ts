/**
 * Story 1.5 — RBAC middleware integration.
 *
 * Covers:
 *   - 401 when the Authorization header is missing or tampered
 *   - 200 when an allow-listed role presents a valid token
 *   - 403 + `{ error: "forbidden", required_role }` when the matrix denies
 *   - rbac_denied audit row is emitted on every denial
 *   - markPublic(handler) lets an anonymous request through authenticate
 *   - requireOwner() enforces Technician → Incident ownership
 *
 * Each test stands up a fresh Express app on a free port; the same
 * test secret (set in beforeEach) signs access tokens minted from the
 * shared `issueAccessToken` helper.
 */
import express from "express";
import { type Server, createServer } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AuditAction } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit";
import { issueAccessToken } from "../auth/jwt";
import { authenticate, authorize, markPublic, requireOwner } from "./authorize";

const STRONG_SECRET = "x".repeat(64);
let originalSecret: string | undefined;

const setSecret = (v: string | undefined) => {
  if (v === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = v;
};

interface AuditEvent {
  readonly auditAction: AuditAction;
  readonly userId?: string;
  readonly outcome: "success" | "failure" | "allow";
  readonly context?: Record<string, unknown>;
}

const startApp = async (
  audit: AuditLogger,
  mount: (app: express.Express) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  mount(app);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { url, close };
};

const ADMIN_UUID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_UUID = "00000000-0000-4000-8000-00000000a002";
const TECHNICIAN_UUID = "00000000-0000-4000-8000-00000000a003";
const VIEWER_UUID = "00000000-0000-4000-8000-00000000a004";

const tokenFor = (userId: string): string => issueAccessToken({ userId }).token;

describe("Story 1.5 — authenticate()", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  const mountEcho = (audit: AuditLogger) => (app: express.Express) => {
    app.use(authenticate);
    app.get("/echo", authorize({ action: "read", resource: "Device" }, audit), (req, res) => {
      res.status(200).json({ user: req.user });
    });
  };

  it("returns 401 when no Authorization header is presented", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountEcho(audit));

    const res = await fetch(`${url}/echo`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "unauthorized" });
    await close();
  });

  it("returns 401 when the token is tampered", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountEcho(audit));

    const real = tokenFor(ADMIN_UUID);
    const tampered = `${real.slice(0, -3)}AAA`;
    const res = await fetch(`${url}/echo`, {
      headers: { Authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
    await close();
  });

  it("returns 401 when the token is well-formed but the subject is unknown", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountEcho(audit));

    const orphan = tokenFor("00000000-0000-4000-8000-deadbeefdead");
    const res = await fetch(`${url}/echo`, {
      headers: { Authorization: `Bearer ${orphan}` },
    });
    expect(res.status).toBe(401);
    await close();
  });

  it("lets a public route through when no token is presented", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, (app) => {
      // The public-flag wrapper must run BEFORE authenticate, so it
      // is mounted as the first per-route middleware.
      app.get(
        "/healthz",
        markPublic((_req, res) => {
          res.status(200).json({ ok: true });
        }),
      );
      app.use(authenticate);
    });

    const res = await fetch(`${url}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body).toEqual({ ok: true });
    await close();
  });
});

describe("Story 1.5 — authorize()", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  const mountDevices = (audit: AuditLogger) => (app: express.Express) => {
    app.use(authenticate);
    app.get("/devices", authorize({ action: "read", resource: "Device" }, audit), (_req, res) => {
      res.status(200).json({ ok: true });
    });
  };

  it("returns 200 + passes the handler when the matrix grants", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountDevices(audit));

    const res = await fetch(`${url}/devices`, {
      headers: { Authorization: `Bearer ${tokenFor(ADMIN_UUID)}` },
    });
    expect(res.status).toBe(200);
    // The middleware now writes a `rbac_allowed` audit row on every
    // successful authorization (see authorize.ts:206-215). The
    // allow-row carries `outcome: "allow"`; denials still write
    // `rbac_denied` with `outcome: "failure"`. Operational dashboards
    // key off the allow-row to count permitted vs denied attempts.
    expect(events).toEqual([
      expect.objectContaining({
        auditAction: "rbac_allowed",
        outcome: "allow",
        context: expect.objectContaining({
          subject: "Admin",
          action: "read",
          resource: "Device",
        }),
      }),
    ]);
    await close();
  });
});

describe("Story 1.5 — RBAC negative paths from RBAC_NEGATIVE_CASES", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  /**
   * Each negative case mounts the endpoint with the (action, resource)
   * pair implied by its appendix row. The (subject, expected) pair
   * from `RBAC_NEGATIVE_CASES` drives the assertion.
   */
  const mountForTriple =
    (
      audit: AuditLogger,
      action: "read" | "manage" | "drive" | "submit_result" | "update",
      resource:
        | "AuditLog"
        | "User"
        | "Simulator"
        | "Incident"
        | "Reading"
        | "SeverityBanner"
        | "Rule",
    ) =>
    (app: express.Express) => {
      app.use(authenticate);
      app.get("/probe", authorize({ action, resource }, audit), (_req, res) => {
        res.status(200).json({ ok: true });
      });
    };

  it("denies Operator → read → AuditLog (403 + audit)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountForTriple(audit, "read", "AuditLog"));

    const res = await fetch(`${url}/probe`, {
      headers: { Authorization: `Bearer ${tokenFor(OPERATOR_UUID)}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.required_role).toBe("Admin");

    const denial = events.find((e) => e.auditAction === "rbac_denied");
    expect(denial).toBeDefined();
    expect(denial?.outcome).toBe("failure");
    expect(denial?.context).toMatchObject({
      subject: "Operator",
      action: "read",
      resource: "AuditLog",
      required_role: "Admin",
    });
    await close();
  });

  it("denies Operator → manage → User (403 + audit)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountForTriple(audit, "manage", "User"));

    const res = await fetch(`${url}/probe`, {
      headers: { Authorization: `Bearer ${tokenFor(OPERATOR_UUID)}` },
    });
    expect(res.status).toBe(403);
    expect(events.find((e) => e.auditAction === "rbac_denied")).toBeDefined();
    await close();
  });

  it("denies Operator → drive → Simulator (403 + audit)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountForTriple(audit, "drive", "Simulator"));

    const res = await fetch(`${url}/probe`, {
      headers: { Authorization: `Bearer ${tokenFor(OPERATOR_UUID)}` },
    });
    expect(res.status).toBe(403);
    expect(events.find((e) => e.auditAction === "rbac_denied")).toBeDefined();
    await close();
  });

  it("denies Viewer → submit_result → Incident (403 + audit)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(
      audit,
      mountForTriple(audit, "submit_result", "Incident"),
    );

    const res = await fetch(`${url}/probe`, {
      headers: { Authorization: `Bearer ${tokenFor(VIEWER_UUID)}` },
    });
    expect(res.status).toBe(403);
    expect(events.find((e) => e.auditAction === "rbac_denied")).toBeDefined();
    await close();
  });

  it("denies Viewer → update → Rule (403 + audit)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, mountForTriple(audit, "update", "Rule"));

    const res = await fetch(`${url}/probe`, {
      headers: { Authorization: `Bearer ${tokenFor(VIEWER_UUID)}` },
    });
    expect(res.status).toBe(403);
    expect(events.find((e) => e.auditAction === "rbac_denied")).toBeDefined();
    await close();
  });

  it("admits Technician → submit_result → Incident (matrix-level pass)", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(
      audit,
      mountForTriple(audit, "submit_result", "Incident"),
    );

    const res = await fetch(`${url}/probe`, {
      headers: { Authorization: `Bearer ${tokenFor(TECHNICIAN_UUID)}` },
    });
    expect(res.status).toBe(200);
    // Successful matrix-level pass writes a `rbac_allowed` row (see
    // `rbac_allowed` emit pin in `authorize.ts:206-215`). The
    // `requireOwner()` middleware downstream may write a SECOND row
    // only on the deny branch; on the admit branch no further audit
    // is emitted. So the events array carries exactly one
    // `rbac_allowed` row.
    expect(events).toEqual([
      expect.objectContaining({
        auditAction: "rbac_allowed",
        outcome: "allow",
        context: expect.objectContaining({
          subject: "Technician",
          action: "submit_result",
          resource: "Incident",
        }),
      }),
    ]);
    await close();
  });
});

describe("Story 1.5 — requireOwner()", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  it("admits the assignee and writes no audit", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, (app) => {
      app.use(authenticate);
      app.get(
        "/incidents/:id",
        authorize({ action: "read", resource: "Incident" }, audit),
        requireOwner(TECHNICIAN_UUID, audit),
        (_req, res) => {
          res.status(200).json({ ok: true });
        },
      );
    });

    const res = await fetch(`${url}/incidents/abc`, {
      headers: { Authorization: `Bearer ${tokenFor(TECHNICIAN_UUID)}` },
    });
    expect(res.status).toBe(200);
    // Assignee Technician: `authorize()` writes a `rbac_allowed` row
    // (matrix grants Technician → read Incident) and `requireOwner()`
    // is a no-op (assignee matches). Exactly one row in the events
    // array — the allow-row.
    expect(events).toEqual([
      expect.objectContaining({
        auditAction: "rbac_allowed",
        outcome: "allow",
        context: expect.objectContaining({
          subject: "Technician",
          action: "read",
          resource: "Incident",
        }),
      }),
    ]);
    await close();
  });

  it("denies a non-assignee Technician with 403 + rbac_denied", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit, (app) => {
      app.use(authenticate);
      app.get(
        "/incidents/:id",
        authorize({ action: "read", resource: "Incident" }, audit),
        requireOwner(ADMIN_UUID, audit),
        (_req, res) => {
          res.status(200).json({ ok: true });
        },
      );
    });

    const res = await fetch(`${url}/incidents/abc`, {
      headers: { Authorization: `Bearer ${tokenFor(TECHNICIAN_UUID)}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.required_role).toBe("Technician");
    const denial = events.find((e) => e.auditAction === "rbac_denied");
    expect(denial?.context).toMatchObject({ reason: "not_assignee" });
    await close();
  });
});
