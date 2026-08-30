/**
 * Idempotency-Key middleware — closes api critique P1 #2.
 *
 * Covers:
 *   - `IdempotencyStore.lookup` returns null on miss
 *   - `IdempotencyStore.lookup` returns the cached entry within TTL
 *   - `IdempotencyStore.lookup` evicts expired entries on access
 *   - `IdempotencyStore.reset()` wipes state (test-only hook)
 *   - Middleware pass-through on missing `Idempotency-Key` header
 *   - Middleware 400 on malformed (non-UUIDv4) key
 *   - Middleware replays cached response on duplicate key within TTL
 *   - Middleware records the handler's terminal 2xx/4xx response
 *   - Middleware does NOT cache 5xx responses
 *
 * Each test stands up a fresh Express app on a free port and seeds
 * an authenticated `req.user` via a stub middleware that runs before
 * the idempotency middleware. Same pattern as `authorize.spec.ts`.
 */
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { type AuthorizedRequest } from "./authorize";
import { IdempotencyStore, IDEMPOTENCY_TTL_MS, idempotency } from "./idempotency";

const VALID_UUID_V4 = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const OTHER_UUID_V4 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER_ID = "00000000-0000-4000-8000-00000000a001";

const startApp = async (
  store: IdempotencyStore,
  fixedNow: number,
  mount: (app: Express) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  // Stub auth — sets `req.user.id` so the idempotency middleware
  // can scope the cache key to the authenticated principal.
  app.use((req, _res, next) => {
    const areq = req as AuthorizedRequest;
    areq.user = { id: USER_ID, role: "Admin", scope: "" };
    next();
  });
  app.use(idempotency(store, () => fixedNow));
  mount(app);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

describe("IdempotencyStore — unit tests", () => {
  it("returns null on a cold cache", () => {
    const store = new IdempotencyStore();
    expect(store.lookup("any", 1_000)).toBeNull();
  });

  it("returns the cached entry within TTL", () => {
    const store = new IdempotencyStore();
    store.record("k", 200, { ok: true }, 1_000);
    expect(store.lookup("k", 1_000 + IDEMPOTENCY_TTL_MS - 1)).toEqual({
      status: 200,
      body: { ok: true },
      expiresAtMs: 1_000 + IDEMPOTENCY_TTL_MS,
    });
  });

  it("auto-evicts expired entries on access", () => {
    const store = new IdempotencyStore();
    store.record("k", 200, { ok: true }, 1_000);
    // Just past TTL — entry should be evicted and lookup returns null.
    expect(store.lookup("k", 1_000 + IDEMPOTENCY_TTL_MS)).toBeNull();
    // Second lookup confirms the eviction persisted.
    expect(store.lookup("k", 1_000 + IDEMPOTENCY_TTL_MS + 100)).toBeNull();
  });

  it("reset() wipes all state", () => {
    const store = new IdempotencyStore();
    store.record("a", 200, { x: 1 }, 1_000);
    store.record("b", 200, { x: 2 }, 1_000);
    store.reset();
    expect(store.lookup("a", 1_000)).toBeNull();
    expect(store.lookup("b", 1_000)).toBeNull();
  });
});

describe("idempotency() — middleware integration", () => {
  const mountHandler = (app: Express): void => {
    let count = 0;
    app.post("/incidents/:id/acknowledge", (req, res) => {
      count += 1;
      res.status(200).json({ attempt: count, key: req.headers["idempotency-key"] });
    });
  };

  it("passes through when no Idempotency-Key header is set", async () => {
    const store = new IdempotencyStore();
    const { url, close } = await startApp(store, 1_000_000, mountHandler);

    const res = await fetch(`${url}/incidents/${VALID_UUID_V4}/acknowledge`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attempt: number };
    expect(body.attempt).toBe(1);
    // Pass-through = the handler ran once; nothing cached.
    expect(
      store.lookup(
        `${USER_ID}|POST|/incidents/${VALID_UUID_V4}/acknowledge|${VALID_UUID_V4}`,
        1_000_000,
      ),
    ).toBeNull();

    await close();
  });

  it("returns 400 invalid_idempotency_key for a malformed header", async () => {
    const store = new IdempotencyStore();
    const { url, close } = await startApp(store, 1_000_000, mountHandler);

    const res = await fetch(`${url}/incidents/${VALID_UUID_V4}/acknowledge`, {
      method: "POST",
      headers: { "Idempotency-Key": "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_idempotency_key");

    await close();
  });

  it("replays the cached response on a duplicate key within TTL", async () => {
    const store = new IdempotencyStore();
    const { url, close } = await startApp(store, 1_000_000, mountHandler);

    const first = await fetch(`${url}/incidents/${VALID_UUID_V4}/acknowledge`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { attempt: number; key: string };
    expect(firstBody.attempt).toBe(1);
    expect(firstBody.key).toBe(VALID_UUID_V4);

    // Second request — handler must NOT have been called again; the
    // cached body is replayed byte-for-byte (same `attempt: 1`).
    const second = await fetch(`${url}/incidents/${VALID_UUID_V4}/acknowledge`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { attempt: number; key: string };
    expect(secondBody.attempt).toBe(1);
    expect(secondBody.key).toBe(VALID_UUID_V4);

    await close();
  });

  it("runs the handler again after the TTL window has elapsed", async () => {
    const store = new IdempotencyStore();
    // First call at t=1000; second call at t=1000 + TTL + 1 ms.
    const { url, close } = await startApp(store, 1_000, mountHandler);

    const first = await fetch(`${url}/incidents/${VALID_UUID_V4}/acknowledge`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { attempt: number }).attempt).toBe(1);

    await close();

    // Fresh app instance + new `now` past the TTL so the first
    // request's entry is evicted on the next lookup.
    const { url: url2, close: close2 } = await startApp(
      store,
      1_000 + IDEMPOTENCY_TTL_MS + 1,
      mountHandler,
    );

    const second = await fetch(`${url2}/incidents/${VALID_UUID_V4}/acknowledge`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { attempt: number }).attempt).toBe(1);

    await close2();
  });

  it("scopes the cache key to the authenticated user (two users share no cache)", async () => {
    const store = new IdempotencyStore();
    const USER_ID_ALT = "00000000-0000-4000-8000-00000000b002";

    interface AppHandle {
      readonly url: string;
      readonly close: () => Promise<void>;
    }
    const startAppWithUser = async (uid: string, fixedNow: number): Promise<AppHandle> => {
      const app = express();
      app.use((req, _res, next) => {
        const areq = req as AuthorizedRequest;
        areq.user = { id: uid, role: "Admin", scope: "" };
        next();
      });
      app.use(idempotency(store, () => fixedNow));
      let count = 0;
      app.post("/x", (_req, res) => {
        count += 1;
        res.status(200).json({ user: uid, attempt: count });
      });
      const server: Server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address() as AddressInfo;
      return {
        url: `http://127.0.0.1:${addr.port}`,
        close: async () => {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        },
      };
    };

    const a = await startAppWithUser(USER_ID, 1_000);
    const b = await startAppWithUser(USER_ID_ALT, 1_000);

    const aRes = await fetch(`${a.url}/x`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(aRes.status).toBe(200);
    expect(((await aRes.json()) as { user: string; attempt: number }).user).toBe(USER_ID);

    const bRes = await fetch(`${b.url}/x`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(bRes.status).toBe(200);
    const bBody = (await bRes.json()) as { user: string; attempt: number };
    // B got attempt=1, not a replay of A's cached body — the cache
    // key includes the user id so the two users don't collide.
    expect(bBody.user).toBe(USER_ID_ALT);
    expect(bBody.attempt).toBe(1);

    await a.close();
    await b.close();
  });

  it("does NOT cache 5xx responses (client may retry with the same key)", async () => {
    const store = new IdempotencyStore();
    let firstTry = true;
    const mount500Then200 = (app: Express): void => {
      app.post("/flaky", (_req, res) => {
        if (firstTry) {
          firstTry = false;
          res.status(503).json({ error: "transient" });
          return;
        }
        res.status(200).json({ ok: true });
      });
    };

    const { url, close } = await startApp(store, 1_000_000, mount500Then200);

    const first = await fetch(`${url}/flaky`, {
      method: "POST",
      headers: { "Idempotency-Key": OTHER_UUID_V4 },
    });
    expect(first.status).toBe(503);

    // Second request with the same key — handler runs again, returns 200.
    // (If 503 had been cached, the second response would also be 503.)
    const second = await fetch(`${url}/flaky`, {
      method: "POST",
      headers: { "Idempotency-Key": OTHER_UUID_V4 },
    });
    expect(second.status).toBe(200);

    await close();
  });

  it("caches 4xx responses (client should fix body, not reuse the key)", async () => {
    const store = new IdempotencyStore();
    let count = 0;
    const mountAlways400 = (app: Express): void => {
      app.post("/bad", (_req, res) => {
        count += 1;
        res
          .status(409)
          .json({ error: "invalid_state_transition", reason: "concurrent_modification" });
      });
    };

    const { url, close } = await startApp(store, 1_000_000, mountAlways400);

    const first = await fetch(`${url}/bad`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(first.status).toBe(409);
    expect(count).toBe(1);

    const second = await fetch(`${url}/bad`, {
      method: "POST",
      headers: { "Idempotency-Key": VALID_UUID_V4 },
    });
    expect(second.status).toBe(409);
    // Cached — handler was not called again.
    expect(count).toBe(1);
    expect(await second.json()).toEqual({
      error: "invalid_state_transition",
      reason: "concurrent_modification",
    });

    await close();
  });
});
