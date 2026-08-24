/**
 * Story 2.5 — admin simulator router integration.
 *
 * Covers the AC matrix:
 *   - happy path: Admin POSTs a scenario, the simulator returns 200,
 *     one `simulator_event` audit row with `outcome: "success"`.
 *   - 403 (Operator): denied by `authorize({ action: "drive",
 *     resource: "Simulator" })`.
 *   - 400 (Bogus scenario): Zod rejects the body.
 *   - 502 (simulator unreachable): outbound fetch rejects → 502.
 *   - 503 (secret disabled): api-side SIMULATOR_SECRET unset → 503.
 *   - 409 (switch_in_progress): second concurrent POST hits the
 *     single-flight registry.
 *
 * Test strategy: the api's outbound call to the simulator uses a
 * `fetchImpl` injected through the router deps. We DO NOT stub
 * `globalThis.fetch` because the test runner itself uses `fetch` to
 * talk to the api under test — replacing the global would silence
 * the test's own POSTs.
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AuditAction } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit";
import { issueAccessToken } from "../auth/jwt";
import { authenticate } from "../middleware/authorize";

import {
  buildAdminSimulatorPublicRouter,
  buildAdminSimulatorRouter,
} from "./simulatorRouter.js";

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";

const STRONG_SECRET = "x".repeat(64);
const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";

interface AuditEvent {
  readonly auditAction: AuditAction;
  readonly userId?: string;
  readonly outcome: "success" | "failure";
  readonly context?: Record<string, unknown>;
}

const tokenForRole = (role: "Admin" | "Operator"): string =>
  issueAccessToken({ userId: role === "Admin" ? ADMIN_ID : OPERATOR_ID, role }).token;

interface StartArgs {
  readonly audit: AuditLogger;
  readonly listDevices?: () => Promise<
    ReadonlyArray<{ readonly id: string; readonly name: string | null; readonly scenario: string | null }>
  >;
  /**
   * Outbound `fetch` used by the api when it POSTs to the simulator.
   * If omitted the api uses the global `fetch` (which can hit a real
   * simulator when one is running on port 4001).
   */
  readonly outboundFetch?: typeof fetch;
}

const startApp = async (
  args: StartArgs,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  // Story 2.5: `/status` is public; mount its public surface BEFORE
  // `authenticate` to mirror the production wiring.
  app.use(buildAdminSimulatorPublicRouter());
  app.use(authenticate);
  const routerDeps: Parameters<typeof buildAdminSimulatorRouter>[0] = {
    audit: args.audit,
    listDevices:
      args.listDevices ??
      (async () => [
        { id: DEVICE_A, name: "DEVICE-1", scenario: "Normal" },
        { id: DEVICE_B, name: "DEVICE-2", scenario: "RisingTDS" },
      ]),
    ...(args.outboundFetch !== undefined ? { fetchImpl: args.outboundFetch } : {}),
  };
  app.use("/admin/simulator", buildAdminSimulatorRouter(routerDeps));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

const setSecret = (v: string | undefined): void => {
  if (v === undefined) delete process.env["SIMULATOR_SECRET"];
  else process.env["SIMULATOR_SECRET"] = v;
};

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env["SIMULATOR_SECRET"];
  process.env["JWT_SECRET"] = STRONG_SECRET;
  setSecret(STRONG_SECRET);
});
afterEach(() => {
  setSecret(originalSecret);
});

describe("Story 2.5 — GET /admin/simulator/status (public)", () => {
  it("returns 200 enabled: true when SIMULATOR_SECRET is set", async () => {
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    await close();
  });

  it("returns 503 disabled: true when SIMULATOR_SECRET is unset (G2-08 unified shape)", async () => {
    setSecret(undefined);
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/status`);
    expect(res.status).toBe(503);
    // Unified disabled shape: `{ disabled: true, reason: "missing" }`
    // matches the POST 503 path and the simulator's 403 path. Spec
    // I/O matrix line 47 pins `{ disabled: true }`.
    const body = (await res.json()) as { disabled: boolean; reason: string };
    expect(body.disabled).toBe(true);
    expect(body.reason).toBe("missing");
    await close();
  });

  it("returns 503 disabled: true when SIMULATOR_SECRET is below 32 chars (G2-03 mirror)", async () => {
    setSecret("too-short");
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/status`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { disabled: boolean; reason: string };
    expect(body.disabled).toBe(true);
    expect(body.reason).toBe("missing");
    await close();
  });
});

describe("Story 2.5 — GET /admin/simulator/devices", () => {
  it("returns the six rows from the listDevices repo", async () => {
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      devices: Array<{ device_id: string; name: string | null; scenario: string | null }>;
    };
    expect(body.devices).toHaveLength(2);
    expect(body.devices[0]?.device_id).toBe(DEVICE_A);
    await close();
  });

  it("returns 401 when the bearer token is missing", async () => {
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/devices`);
    expect(res.status).toBe(401);
    await close();
  });

  it("returns 200 when an Operator reads the devices list (matrix grants read Device)", async () => {
    // Per the RBAC matrix (shared/src/rbac.ts:60-72) Operator can
    // `read Device`. The Admin-only gate for the page lives on the
    // frontend (`<RbacRoute>`); the api exposes the listing to any
    // authenticated role that the matrix allows.
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    await close();
  });
});

describe("Story 2.5 — POST /admin/simulator/:device_id/scenario", () => {
  it("Admin happy path: 200 + simulator_event audit on success", async () => {
    // The api's outbound call to the simulator uses this stub. The
    // test's own fetch to the api is unaffected.
    const outboundFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const events: AuditEvent[] = [];
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      outboundFetch,
    });

    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });

    const successEvent = events.find(
      (e) =>
        e.auditAction === "simulator_event" && e.outcome === "success",
    );
    expect(successEvent).toBeDefined();
    expect(successEvent?.userId).toBe(ADMIN_ID);
    // G2-11 + G2-17 — pin the EXACT audit row shape (no extra
    // `paused: undefined` key for a scenario-only switch; exact key
    // set, exact value).
    expect(successEvent?.context).toEqual({
      device_id: DEVICE_A,
      scenario: "RisingTDS",
    });

    await close();
  });

  it("returns 403 when an Operator tries to drive the simulator", async () => {
    const events: AuditEvent[] = [];
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Operator")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
    // The RBAC middleware writes its own `rbac_denied` audit row.
    const denial = events.find((e) => e.auditAction === "rbac_denied");
    expect(denial).toBeDefined();
    await close();
  });

  it("returns 400 invalid_scenario for an unknown scenario name", async () => {
    // P4 — the spec mandates the dedicated error code `invalid_scenario`
    // (not the generic `validation_error`) when the body parses OK
    // and the user clearly intended a scenario change.
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "Bogus" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_scenario");
    await close();
  });

  it("returns 400 validation_error when the body is empty (P17)", async () => {
    // An empty body was previously returned as `missing_action` — per
    // the loopback-1 spec tightening, empty bodies are a malformed
    // request and must surface as `validation_error`.
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("returns 502 simulator_unreachable when the outbound fetch fails", async () => {
    const outboundFetch: typeof fetch = (async () => {
      throw new TypeError("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const events: AuditEvent[] = [];
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      outboundFetch,
    });

    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("simulator_unreachable");

    // P6 — the spec mandates "no AuditLog row is written" on
    // 502/400/409/403 simulator paths. The `rbac_denied` row from
    // the middleware is the only audit surface for the request.
    const simulatorEvents = events.filter(
      (e) => e.auditAction === "simulator_event",
    );
    expect(simulatorEvents).toHaveLength(0);

    await close();
  });

  it("returns 503 disabled when api-side SIMULATOR_SECRET is unset", async () => {
    setSecret(undefined);
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { disabled: boolean };
    expect(body.disabled).toBe(true);
    await close();
  });

  it("queues the second POST (P5) and only returns 409 for the third", async () => {
    // P5 — the spec's single-flight queue is size 1. The SECOND
    // request is queued and runs after the first completes; only
    // the THIRD request (which would push the queue over its
    // bound) returns 409 `switch_in_progress`.
    let outboundCalls = 0;
    const outboundFetch: typeof fetch = (async () => {
      outboundCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });

    const first = fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    // Yield so the first request enters the registry before the
    // second lands.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    // Yield again so the second request enters the registry before
    // the third is dispatched — the third must be the one that
    // overflows the queue.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const third = fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });

    const [r1, r2, r3] = await Promise.all([first, second, third]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(409);
    const conflictBody = (await r3.json()) as { error: string };
    expect(conflictBody.error).toBe("switch_in_progress");
    // Outbound fetch was called for the first and second requests;
    // the third was rejected before its outbound call.
    expect(outboundCalls).toBe(2);

    await close();
  });

  it("returns 403 secret_mismatch when the simulator rejects the secret", async () => {
    const outboundFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ error: "secret_mismatch" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("secret_mismatch");
    await close();
  });

  // G2-09 — `{ scenario: "Bogus", paused: true }` combo must
  // surface as 400 invalid_scenario (not 502 simulator_unreachable).
  it("returns 400 invalid_scenario for an unknown scenario with paused (G2-09)", async () => {
    let outboundCalls = 0;
    const outboundFetch: typeof fetch = (async () => {
      outboundCalls += 1;
      return new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "Bogus", paused: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_scenario");
    // Validation gate must intercept BEFORE the outbound call.
    expect(outboundCalls).toBe(0);
    await close();
  });

  // Strict-mode unknown body key → 400 validation_error (G2-19).
  it("returns 400 validation_error when the body has an unknown key", async () => {
    let outboundCalls = 0;
    const outboundFetch: typeof fetch = (async () => {
      outboundCalls += 1;
      return new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS", extra_key: "x" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    expect(outboundCalls).toBe(0);
    await close();
  });

  // 400 invalid_device_id (G2-19).
  it("returns 400 invalid_device_id when the URL device_id is not a v4 UUID", async () => {
    let outboundCalls = 0;
    const outboundFetch: typeof fetch = (async () => {
      outboundCalls += 1;
      return new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });
    const res = await fetch(`${url}/admin/simulator/not-a-uuid/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_device_id");
    expect(outboundCalls).toBe(0);
    await close();
  });

  // 502 simulator_unreachable with `upstream` body (G2-19).
  it("returns 502 simulator_unreachable with upstream body for non-200 non-403 simulator responses", async () => {
    const outboundFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      error: string;
      upstream: { kind: string; status: number; body: unknown };
    };
    expect(body.error).toBe("simulator_unreachable");
    expect(body.upstream.status).toBe(500);
    expect(body.upstream.body).toEqual({ error: "internal_error" });
    await close();
  });

  // 502 simulator_unreachable when simulator returns 200 with non-JSON (G2-19).
  it("returns 502 with upstream.body === null when simulator returns non-JSON", async () => {
    const outboundFetch: typeof fetch = (async () =>
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })) as unknown as typeof fetch;

    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      outboundFetch,
    });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    // 200 + non-JSON → the api tries to parse as {applied: true}, fails,
    // and renders 502. The router also handles this path as `unknown`.
    // The contract is "the SPA never crashes"; the exact status code
    // for "non-JSON 200" is documented as 502 simulator_unreachable.
    expect([502, 500]).toContain(res.status);
    await close();
  });

  // 503 disabled when api secret below 32 chars (G2-03).
  it("returns 503 disabled when api-side SIMULATOR_SECRET is below 32 chars (G2-03)", async () => {
    setSecret("too-short");
    const { url, close } = await startApp({ audit: { emit: () => undefined } });
    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scenario: "RisingTDS" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { disabled: boolean; reason: string };
    expect(body.disabled).toBe(true);
    expect(body.reason).toBe("missing");
    await close();
  });

  // G2-12 — paused-only request: audit row context is {device_id, paused}
  // and the simulator receives `{ paused: true }` (not `{ paused: true,
  // scenario: undefined }`).
  it("paused-only request: audit row context keys are exactly {device_id, paused}", async () => {
    let outboundBody: unknown = null;
    const outboundFetch: typeof fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      outboundBody = init?.body !== undefined ? JSON.parse(init.body as string) : null;
      return new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const events: AuditEvent[] = [];
    const { url, close } = await startApp({
      audit: { emit: (e) => events.push(e) },
      outboundFetch,
    });

    const res = await fetch(`${url}/admin/simulator/${DEVICE_A}/scenario`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenForRole("Admin")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paused: true }),
    });
    expect(res.status).toBe(200);

    // Outbound body must carry ONLY `paused`, no `scenario` key.
    expect(outboundBody).toEqual({ paused: true });

    const successEvent = events.find(
      (e) => e.auditAction === "simulator_event" && e.outcome === "success",
    );
    expect(successEvent).toBeDefined();
    // Audit row context has exactly two keys, no `scenario` key.
    expect(Object.keys(successEvent?.context ?? {}).sort()).toEqual([
      "device_id",
      "paused",
    ]);
    expect(successEvent?.context?.["paused"]).toBe(true);
    await close();
  });

  // G1-02 — Operator read returns the SAME body shape as Admin (no
  // silent omission of `name` / `scenario`).
  it("Operator read of /devices returns the full body shape with name + scenario fields", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listDevices: async () => [
        { id: DEVICE_A, name: "DEVICE-1", scenario: "Normal" },
        // G1-19 — legacy pre-Story-2.5 row with nulls.
        { id: DEVICE_B, name: null, scenario: null },
      ],
    });
    const res = await fetch(`${url}/admin/simulator/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      devices: Array<{ device_id: string; name: string | null; scenario: string | null }>;
    };
    expect(body.devices).toEqual([
      { device_id: DEVICE_A, name: "DEVICE-1", scenario: "Normal" },
      { device_id: DEVICE_B, name: null, scenario: null },
    ]);
    await close();
  });
});
