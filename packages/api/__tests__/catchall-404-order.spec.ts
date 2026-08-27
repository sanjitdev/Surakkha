/**
 * Catch-all 404 handler — must be mounted AFTER every router mount.
 *
 * Express `app.use((req, res) => res.status(404).end())` is a
 * terminal middleware: once it runs, it sends the 404 response and
 * short-circuits the chain. If the handler is registered BEFORE a
 * router mount, every path that the later router would have matched
 * gets a 404 instead.
 *
 * Bug observed in dev on 2026-08-27: the catch-all was placed
 * between the `admin/thresholds` mount and the
 * `buildIncidentsRouterMount` call, so every
 * `/api/incidents/{active,:id,/:id/events,...}` request returned
 * 404 (the adapter's routes — registered LATER — never saw the
 * request). Only `/api/incidents/recent` worked because its router
 * was mounted BEFORE the catch-all.
 *
 * Fix: move the catch-all to AFTER the
 * `app.use(buildIncidentsRouterMount(...))` block.
 *
 * Why a source-walk test rather than a behavioural one:
 *   - The ordering bug is structural: the only way to express
 *     "the 404 handler is after the adapter mount" is at the
 *     source level. A behavioural test would require booting the
 *     full api (with Prisma + WS + rules engine) which is too
 *     expensive for a regression pin.
 *   - Mirrors the shape of `health.public.spec.ts`.
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

/**
 * Find the line of the catch-all 404 handler. The handler looks
 * like `app.use((_req: Request, res: Response) => { ... })` with
 * the body containing `HTTP_NOT_FOUND`. We match on the
 * `HTTP_NOT_FOUND` body to disambiguate from the many other
 * `app.use((req, res) => ...)` middlewares (e.g. the json parser,
 * cookieParser, authenticate).
 */
const catchAllLine = (source: string): number => {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    // The catch-all 404 handler's body contains `HTTP_NOT_FOUND`
    // (a stable symbol imported from the http constants module).
    // Match the line that combines `app.use` with the 404 status.
    if (
      /app\.use\(/.test(lines[i] ?? "") &&
      // next 5 lines must contain HTTP_NOT_FOUND (the handler body
      // lives within the next few lines after `app.use(`).
      lines.slice(i, i + 5).some((l) => /HTTP_NOT_FOUND/.test(l))
    ) {
      return i + 1;
    }
  }
  throw new Error("expected source to contain catch-all 404 handler");
};

describe("api catch-all 404 — must be mounted after every router", () => {
  it("registers catch-all 404 AFTER buildIncidentsRouterMount", () => {
    const source = readIndex();
    const notFoundLine = catchAllLine(source);
    const incidentsLine = lineOf(source, "buildIncidentsRouterMount({");
    expect(notFoundLine).toBeGreaterThan(incidentsLine);
  });

  it("registers catch-all 404 AFTER buildRecentIncidentsRouter", () => {
    const source = readIndex();
    const notFoundLine = catchAllLine(source);
    const recentLine = lineOf(source, "buildRecentIncidentsRouter(");
    expect(notFoundLine).toBeGreaterThan(recentLine);
  });

  it("registers catch-all 404 AFTER buildThresholdsRouter", () => {
    const source = readIndex();
    const notFoundLine = catchAllLine(source);
    const thresholdsLine = lineOf(source, "buildThresholdsRouter(");
    expect(notFoundLine).toBeGreaterThan(thresholdsLine);
  });

  it("returns the same { error: 'not_found' } shape as the pre-Story 0 stub", () => {
    // Pin the wire contract: the Docker healthcheck + the web app's
    // `Failed to load` surface both check for `error === "not_found"`.
    const source = readIndex();
    expect(source).toMatch(/error: "not_found"/);
  });
});
