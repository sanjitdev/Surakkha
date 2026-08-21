/**
 * Story 1.4 — auth router integration.
 *
 * Covers:
 *   - POST /auth/login 200 → { access_token, token_type: "Bearer", expires_in: 28800 }
 *     + Set-Cookie: surakkha_refresh=...; HttpOnly; SameSite=Strict; Path=/auth
 *   - POST /auth/login 401 → { error: "invalid_credentials" } (no audit)
 *   - POST /auth/login 401 on bad email (no enumeration, no audit)
 *   - POST /auth/login 400 → validation_error on empty body
 *   - POST /auth/refresh 200 → new access token from cookie
 *   - POST /auth/refresh 401 → invalid_refresh on missing / tampered cookie
 *   - login_success audit fires on success, login_failure audit does NOT fire on bad creds
 *
 * The router is mounted on a fresh Express app per test for isolation.
 */
import express from "express";
import cookieParser from "cookie-parser";
import { type Server, createServer } from "node:http";
import { type AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AuditAction } from "@surakkha/shared/rbac";

import { buildAuthRouter, type AuditLogger } from "./router";

interface AuditEvent {
  readonly auditAction: AuditAction;
  readonly userId?: string;
  readonly outcome: "success" | "failure";
}

const startApp = async (
  audit: AuditLogger,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use("/auth", buildAuthRouter({ audit }));

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { url, close };
};

const STRONG_SECRET = "x".repeat(64);
let originalSecret: string | undefined;

const setSecret = (v: string | undefined) => {
  if (v === undefined) delete process.env["JWT_SECRET"];
  else process.env["JWT_SECRET"] = v;
};

describe("Story 1.4 — POST /auth/login", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  it("returns 200 + access token on valid credentials and sets the refresh cookie", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = {
      emit: (e) => events.push(e),
    };
    const { url, close } = await startApp(audit);

    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "operator@surakkha.test", password: "demo-operator" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(28800);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/surakkha_refresh=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    expect(setCookie.toLowerCase()).toContain("path=/auth");

    expect(events).toEqual([
      { auditAction: "login_success", userId: "00000000-0000-4000-8000-00000000a002", outcome: "success" },
    ]);
    await close();
  });

  it("returns 401 + invalid_credentials on a wrong password; no audit", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);

    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "operator@surakkha.test", password: "wrong" }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "invalid_credentials" });
    expect(events).toEqual([]);
    await close();
  });

  it("returns 401 + invalid_credentials on an unknown email; no audit", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);

    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ghost@surakkha.test", password: "anything" }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "invalid_credentials" });
    expect(events).toEqual([]);
    await close();
  });

  it("returns 400 + validation_error on empty body", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);

    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("validation_error");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(events).toEqual([]);
    await close();
  });
});

describe("Story 1.4 — POST /auth/refresh", () => {
  beforeEach(() => {
    originalSecret = process.env["JWT_SECRET"];
    setSecret(STRONG_SECRET);
  });
  afterEach(() => setSecret(originalSecret));

  const loginAndGetCookie = async (url: string): Promise<string> => {
    const res = await fetch(`${url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@surakkha.test", password: "demo-admin" }),
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    // The cookie value is between `surakkha_refresh=` and the first `;`.
    const match = /surakkha_refresh=([^;]+)/.exec(setCookie);
    if (match === null) throw new Error("refresh cookie not set");
    return match[1]!;
  };

  it("returns a new access token from a valid refresh cookie", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);
    const cookie = await loginAndGetCookie(url);

    const res = await fetch(`${url}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `surakkha_refresh=${cookie}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(28800);
    expect(body.access_token.split(".")).toHaveLength(3);
    expect(events.find((e) => e.auditAction === "token_refresh")).toBeDefined();
    await close();
  });

  it("returns 401 when no cookie is presented", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);

    const res = await fetch(`${url}/auth/refresh`, { method: "POST" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "invalid_refresh" });
    expect(events).toEqual([]);
    await close();
  });

  it("returns 401 when the cookie is tampered", async () => {
    const events: AuditEvent[] = [];
    const audit: AuditLogger = { emit: (e) => events.push(e) };
    const { url, close } = await startApp(audit);
    const cookie = await loginAndGetCookie(url);
    const tampered = `${cookie.slice(0, -3)  }AAA`;

    const res = await fetch(`${url}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `surakkha_refresh=${tampered}` },
    });
    expect(res.status).toBe(401);
    await close();
  });
});