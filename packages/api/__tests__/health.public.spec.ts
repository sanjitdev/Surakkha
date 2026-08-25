/**
 * `/health` — public-route contract (Docker healthcheck ordering).
 *
 * Pins the v1 contract: the `GET /health` endpoint MUST be mounted
 * BEFORE `app.use(authenticate)` so the Docker Compose healthcheck
 * (a bare `fetch('http://localhost:3000/health')` with no
 * Authorization header) returns 200 instead of 401.
 *
 * Without this ordering:
 *   1. `authenticate` short-circuits with 401 because the request
 *      has no token AND `req.public` is not set.
 *   2. The api container's healthcheck fails repeatedly.
 *   3. `depends_on: api: { condition: service_healthy }` from the
 *      simulator (and base docker-compose.yml) never resolves, so
 *      those services never start.
 *
 * Why a source-walk test rather than a unit test:
 *   - The ordering bug is structural — the only way to express
 *     "this route is registered before that middleware" is at the
 *     source level. A behavioural test would have to spin up an
 *     Express instance with the same middleware and assert the
 *     order via .use() ordering, which is what the assertion below
 *     already does directly against the file's text.
 *   - Mirrors the shape of `boot.skipMigrations.spec.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_RELATIVE = join("src", "index.ts");

const readIndex = (): string => readFileSync(SRC_RELATIVE, "utf8");

const lineOf = (source: string, needle: string): number => {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.includes(needle)) {
      return i + 1;
    }
  }
  throw new Error(`expected source to contain \`${needle}\``);
};

describe("api /health — public-route contract", () => {
  it("registers GET /health so the Docker healthcheck resolves", () => {
    const source = readIndex();
    // Express mount: `app.get("/health", ...)`. We assert the
    // exact-string shape so a future reader who renames the route
    // sees the test fail loudly with a hint to update this pin and
    // the corresponding `docker-compose.*.yml` healthcheck blocks.
    expect(source).toMatch(/app\.get\(["']\/health["']/);
  });

  it("registers /health BEFORE app.use(authenticate)", () => {
    const source = readIndex();
    // The whole point of the fix: ordering. If a future refactor
    // moves the handler back below `authenticate`, the Docker
    // healthcheck regresses silently — this assertion makes the
    // ordering explicit.
    const healthLine = lineOf(source, `app.get("/health"`);
    const authLine = lineOf(source, "app.use(authenticate)");
    expect(healthLine).toBeLessThan(authLine);
  });

  it("does NOT require markPublic() — route ordering is the gate", () => {
    // Defensive: if someone re-introduces `markPublic` wrapping on
    // /health, the ordering test above still passes but the
    // intent has shifted from "public-via-ordering" to
    // "public-via-wrapper". Either is valid; we want to know which
    // strategy we use, so we pin on the source not containing a
    // markPublic call near the /health route.
    const source = readIndex();
    const healthLine = lineOf(source, `app.get("/health"`);
    const lines = source.split("\n");
    // Look ±5 lines around the route for `markPublic(`.
    for (
      let i = Math.max(0, healthLine - 6);
      i < Math.min(lines.length, healthLine + 5);
      i += 1
    ) {
      expect(lines[i] ?? "").not.toMatch(/markPublic/);
    }
  });
});