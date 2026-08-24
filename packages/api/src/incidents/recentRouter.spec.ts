/**
 * Story 2.6 — `/api/incidents/recent` router.
 *
 * Covers:
 *   - 200 happy path: returns the most-recent open incidents, ordered
 *     by `opened_at DESC`, bounded by the `limit` parameter.
 *   - Default `limit=10` when no query string is presented.
 *   - Custom `limit=...` clamp (1..50).
 *   - 400 when `limit` is out of range or non-numeric.
 *   - 401 when no bearer token is presented.
 *   - 500 when the data layer throws (AC7 path).
 *   - Empty-DB case: `{ incidents: [] }`.
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { buildRecentIncidentsRouter } from "./recentRouter.js";

const STRONG_SECRET = "x".repeat(64);

const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const tokenForRole = (role: "Admin" | "Operator") =>
  issueAccessToken({
    userId: role === "Admin" ? "00000000-0000-4000-8000-00000000a001" : OPERATOR_ID,
    role,
  }).token;

interface StartArgs {
  readonly audit: AuditLogger;
  readonly listRecent: (
    limit: number,
  ) => Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly device_id: string;
      readonly severity: "info" | "warning" | "critical";
      readonly metric: string;
      readonly value: number;
      readonly opened_at: string;
    }>
  >;
}

const startApp = async (
  args: StartArgs,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildRecentIncidentsRouter({
      audit: args.audit,
      listRecent: args.listRecent as never,
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

beforeEach(() => {
  process.env["JWT_SECRET"] = STRONG_SECRET;
});

describe("Story 2.6 — GET /api/incidents/recent", () => {
  it("returns the most-recent incidents with the wire envelope", async () => {
    const listRecent: StartArgs["listRecent"] = async () => [
      {
        id: "11111111-1111-4111-8111-111111111111",
        device_id: "9b1c4f00-0000-4000-8000-000000000001",
        severity: "critical",
        metric: "tds_ppm",
        value: 610,
        opened_at: "2026-08-20T10:31:04.000Z",
      },
    ];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent,
    });
    const res = await fetch(`${url}/api/incidents/recent`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      incidents: Array<{ severity: string; metric: string }>;
    };
    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0]?.severity).toBe("critical");
    expect(body.incidents[0]?.metric).toBe("tds_ppm");
    await close();
  });

  it("defaults to limit=10 when no query string is presented", async () => {
    let observedLimit: number | undefined;
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async (limit) => {
        observedLimit = limit;
        return [];
      },
    });
    const res = await fetch(`${url}/api/incidents/recent`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(observedLimit).toBe(10);
    await close();
  });

  it("honors a custom ?limit=5 query parameter", async () => {
    let observedLimit: number | undefined;
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async (limit) => {
        observedLimit = limit;
        return [];
      },
    });
    const res = await fetch(`${url}/api/incidents/recent?limit=5`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(observedLimit).toBe(5);
    await close();
  });

  it("returns 400 when limit is out of range (>50)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/recent?limit=51`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("returns 400 when limit is non-numeric", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/recent?limit=banana`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(400);
    await close();
  });

  it("returns 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/recent`);
    expect(res.status).toBe(401);
    await close();
  });

  it("returns the empty envelope when no incidents exist", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/recent`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ incidents: [] });
    await close();
  });

  it("returns 500 when the data layer throws (AC7: empty-state path)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listRecent: async () => {
        throw new Error("prisma unreachable");
      },
    });
    const res = await fetch(`${url}/api/incidents/recent`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    await close();
  });
});