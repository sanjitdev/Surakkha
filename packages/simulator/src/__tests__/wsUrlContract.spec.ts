/**
 * `packages/simulator/src/wsClient.ts` URL contract pin.
 *
 * Socket.IO v4 derives the namespace from the URL path segment
 * AFTER the engine.io `path`. The previous simulator connected to
 * `${apiUrl}/ingest/<device_id>` which made the namespace `/<uuid>`
 * — unknown to the api (`Invalid namespace` → connection refused).
 * The api root-namespace ingest handler never received those
 * connections.
 *
 * The fix is on the simulator side: connect to `${apiUrl}` with
 * engine.io `path: "/ingest/"` (namespace = `/`) and pass the
 * device_id via `auth.device_id` instead of the URL path.
 *
 * This source-walk contract pin asserts the simulator's URL
 * construction shape so future refactors can't silently re-introduce
 * the namespace bug.
 *
 * Mirrors the shape of
 *   packages/api/__tests__/health.public.spec.ts
 *   packages/web/src/__tests__/nginx.routes.spec.ts
 *   packages/simulator/src/__tests__/dockerfile.devicesJson.spec.ts
 * — text-shape, no runtime required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// Spec: packages/simulator/src/__tests__/wsUrlContract.spec.ts
// Source: packages/simulator/src/wsClient.ts — two levels up.
const WS_CLIENT_PATH = join(HERE, "..", "wsClient.ts");
const readWsClient = (): string => readFileSync(WS_CLIENT_PATH, "utf8");

describe("simulator wsClient URL contract", () => {
  const src = readWsClient();

  it("does NOT put the device_id in the URL path", () => {
    // The regression marker: `${apiUrl}/ingest/${deviceId}`. With
    // engine path `/ingest/`, this becomes namespace `/<uuid>`
    // (unknown to the api).
    expect(src).not.toMatch(/\$\{[^}]*apiUrl[^}]*\}\/ingest\/\$\{[^}]*deviceId/);
  });

  it("connects to the apiUrl base (no /ingest/<uuid> path)", () => {
    // Pin the actual production line: `const url =
    // this.opts.apiUrl.replace(/\/$/, "");` — strips trailing slash,
    // no further path manipulation.
    expect(src).toMatch(/apiUrl\.replace\(/);
    // The URL has NO `/ingest/` segment after the base.
    expect(src).not.toMatch(/apiUrl[^;]*\/ingest\//);
  });

  it("passes the device_id via the auth.device_id payload", () => {
    // The api's `parseDeviceIdFromHandshake` reads
    // `socket.handshake.auth?.["device_id"]` (priority over URL
    // path). The simulator must therefore send it.
    expect(src).toMatch(/device_id:\s*this\.opts\.deviceId/);
  });

  it("uses the engine.io path /ingest/ (matches api IoServer config)", () => {
    // api index.ts: `new IoServer(httpServer, { path:
    // INGEST_PATH_PREFIX })` where INGEST_PATH_PREFIX = "/ingest/".
    // The simulator client must use the same engine.io path.
    expect(src).toMatch(/path:\s*"\/ingest\/"/);
  });
});