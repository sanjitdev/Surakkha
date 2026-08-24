/**
 * Story 2.5 — Simulator control HTTP server.
 *
 * Pins:
 *   - secret match accepts (200 with `{ applied: true }`)
 *   - secret mismatch → 403 `{ error: "secret_mismatch" }`
 *   - missing env → status 503 disabled; POST 503 disabled
 *   - valid POST swaps the WsClient scenario
 *   - invalid scenario name → 400 `{ error: "invalid_scenario" }`
 *   - unknown device_id → 404 `{ error: "unknown_device" }`
 *   - secret compare is constant-time (different lengths → 403, no
 *     timing oracle)
 */
import {
  type AddressInfo,
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildControlHandler,
  type SimulatorClientLike,
  setClientsRegistry,
  startControlServer,
} from "./server.js";

const VALID_DEVICE = "9b1c4f00-0000-4000-8000-000000000001";
const UNKNOWN_DEVICE = "9b1c4f00-0000-4000-8000-deadbeefdead";
const STRONG_SECRET = "x".repeat(64);
const SECRET_HEADER = "X-Simulator-Secret";

type StubClient = SimulatorClientLike & {
  __test__scenario: () => ScenarioName;
  __test__paused: () => boolean;
};

const stubClient = (initial: ScenarioName): StubClient => {
  let scenario: ScenarioName = initial;
  let paused = false;
  const client: StubClient = {
    setScenario: (next) => {
      scenario = next;
    },
    setPaused: (next) => {
      paused = next;
    },
    __test__scenario: () => scenario,
    __test__paused: () => paused,
  };
  return client;
};

const startServer = async (
  registry: Map<string, SimulatorClientLike>,
): Promise<{ url: string; close: () => Promise<void> }> => {
  // Replace the registry BEFORE the server boots so the handler sees
  // our stubbed clients.
  setClientsRegistry(registry);
  const server: Server = createServer(buildControlHandler());
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env["SIMULATOR_SECRET"];
  process.env["SIMULATOR_SECRET"] = STRONG_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env["SIMULATOR_SECRET"];
  else process.env["SIMULATOR_SECRET"] = originalSecret;
  setClientsRegistry(new Map());
});

describe("Story 2.5 — control server GET /admin/simulator/status", () => {
  it("returns 200 { enabled: true } when secret matches", async () => {
    const { url, close } = await startServer(new Map());
    const res = await fetch(`${url}/admin/simulator/status`, {
      headers: { [SECRET_HEADER]: STRONG_SECRET },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    await close();
  });

  it("returns 403 secret_mismatch on a wrong secret", async () => {
    const { url, close } = await startServer(new Map());
    const res = await fetch(`${url}/admin/simulator/status`, {
      headers: { [SECRET_HEADER]: "y".repeat(64) },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "secret_mismatch" });
    await close();
  });

  it("returns 403 secret_mismatch when SIMULATOR_SECRET is unset (collapsed disabled state)", async () => {
    delete process.env["SIMULATOR_SECRET"];
    const { url, close } = await startServer(new Map());
    const res = await fetch(`${url}/admin/simulator/status`);
    // Missing env on the simulator side now returns 403 with the
    // `secret_mismatch` body — same path the api's simulatorClient
    // maps to the disabled banner via AC8. (Spec line 110 mandates
    // 403 for missing env; was 503 in the v1 implementation.)
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("secret_mismatch");
    expect(body.reason).toBe("missing");
    await close();
  });

  it("returns 403 secret_mismatch when SIMULATOR_SECRET is below 32 chars", async () => {
    process.env["SIMULATOR_SECRET"] = "too-short";
    const { url, close } = await startServer(new Map());
    const res = await fetch(`${url}/admin/simulator/status`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("secret_mismatch");
    expect(body.reason).toBe("missing");
    await close();
  });
});

describe("Story 2.5 — control server POST /admin/simulator/:device_id/scenario", () => {
  it("applies the new scenario on a valid request", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: "RisingTDS" }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    expect(
      (client as SimulatorClientLike & { __test__scenario: () => string })
        .__test__scenario(),
    ).toBe("RisingTDS");
    await close();
  });

  it("rejects an unknown scenario with 400 invalid_scenario", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: "Bogus" }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_scenario" });
    expect(
      (client as SimulatorClientLike & { __test__scenario: () => string })
        .__test__scenario(),
    ).toBe("Normal");
    await close();
  });

  it("rejects an unknown device_id with 404 unknown_device", async () => {
    const { url, close } = await startServer(new Map());
    const res = await fetch(
      `${url}/admin/simulator/${UNKNOWN_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: "RisingTDS" }),
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown_device" });
    await close();
  });

  it("rejects a wrong-length secret with 403 secret_mismatch (no timing oracle)", async () => {
    const { url, close } = await startServer(new Map());
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: "y".repeat(8),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: "RisingTDS" }),
      },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "secret_mismatch" });
    await close();
  });

  it("rejects an equal-length-different-content secret with 403 secret_mismatch (timingSafeEqual path)", async () => {
    // The length-mismatch path short-circuits before
    // `timingSafeEqual` is called; this test exercises the actual
    // byte-by-byte compare. Two 64-char secrets that differ in
    // content but share length — the only path through
    // `timingSafeEqual`.
    const wrongSecret = "y".repeat(64);
    expect(wrongSecret.length).toBe(STRONG_SECRET.length);
    expect(wrongSecret).not.toBe(STRONG_SECRET);
    const { url, close } = await startServer(new Map());
    const res = await fetch(
      `${url}/admin/simulator/status`,
      {
        headers: { [SECRET_HEADER]: wrongSecret },
      },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "secret_mismatch" });
    await close();
  });

  it("applies a paused toggle via the same endpoint", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paused: true }),
      },
    );
    expect(res.status).toBe(200);
    expect(
      (client as SimulatorClientLike & { __test__paused: () => boolean })
        .__test__paused(),
    ).toBe(true);
    await close();
  });

  it("returns 403 secret_mismatch on POST when SIMULATOR_SECRET is unset (G2-01)", async () => {
    delete process.env["SIMULATOR_SECRET"];
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: "RisingTDS" }),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("secret_mismatch");
    await close();
  });

  it("rejects GET on the scenario endpoint with 400 method_not_allowed", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "GET",
        headers: { [SECRET_HEADER]: STRONG_SECRET },
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
    await close();
  });

  it("rejects PUT on the scenario endpoint with 400 method_not_allowed", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "PUT",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario: "RisingTDS" }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
    await close();
  });

  it("returns 400 payload_too_large when body exceeds 16 KiB", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    // 17 KB of valid JSON content — the request lib may split this
    // into multiple TCP chunks; the server accumulates until the
    // cap is exceeded.
    const huge = "x".repeat(17 * 1024);
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: `{"scenario":"${huge}"}`,
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    await close();
  });

  it("returns 400 invalid_json on malformed body", async () => {
    const client = stubClient("Normal");
    const { url, close } = await startServer(
      new Map([[VALID_DEVICE, client]]),
    );
    const res = await fetch(
      `${url}/admin/simulator/${VALID_DEVICE}/scenario`,
      {
        method: "POST",
        headers: {
          [SECRET_HEADER]: STRONG_SECRET,
          "Content-Type": "application/json",
        },
        body: "{ scenario: \"RisingTDS\" ", // unterminated — invalid JSON
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    await close();
  });

  it("returns 404 not_found on unknown path (G2-14)", async () => {
    const { url, close } = await startServer(new Map());
    const res = await fetch(`${url}/admin/wibble`, {
      headers: { [SECRET_HEADER]: STRONG_SECRET },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    await close();
  });

  it("returns 404 not_found on bare /admin/simulator/<uuid> with no /scenario suffix (G2-14)", async () => {
    const { url, close } = await startServer(new Map());
    const res = await fetch(`${url}/admin/simulator/${VALID_DEVICE}`, {
      headers: { [SECRET_HEADER]: STRONG_SECRET },
    });
    // Bare-GET fallback removed in G2-14; the parser now rejects
    // any path that doesn't end in /scenario.
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    await close();
  });
});

describe("Story 2.5 — startControlServer boots on env-supplied port", () => {
  it("returns a positive kernel-assigned port and accepts traffic (G2-17)", async () => {
    process.env["SIMULATOR_CONTROL_PORT"] = "0";
    setClientsRegistry(new Map());
    const { port, close } = await startControlServer();
    expect(port).toBeGreaterThan(0);
    // Smoke-test that the server is actually listening (not just
    // that listen() returned). A request with no secret header
    // must surface 403.
    const res = await fetch(`http://127.0.0.1:${port}/admin/simulator/status`);
    expect(res.status).toBe(403);
    await close();
  });
});

// Inert imports to avoid TS unused warnings on test seam fields.
type _IncomingMessage = IncomingMessage;
type _ServerResponse = ServerResponse;
const _inert: _IncomingMessage | undefined = undefined;
const _inert2: _ServerResponse | undefined = undefined;
void _inert;
void _inert2;
