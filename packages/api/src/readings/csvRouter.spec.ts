/**
 * Story 5.2 — `GET /api/devices/:deviceId/readings.csv` router.
 *
 * Coverage map (each row of the spec's I/O matrix pinned by at
 * least one test):
 *
 *   HAPPY_PATH_OPERATOR       → "streams the CSV for an Operator token"
 *   HAPPY_PATH_ADMIN          → "streams the CSV for an Admin token"
 *   HAPPY_PATH_EMPTY          → "returns header + trailer when the device has zero readings"
 *   TRUNCATED                 → "writes the truncated trailer when the row cap is reached"
 *   RBAC_DENIED_TECH          → "returns 403 + forbidden for a Technician token"
 *   RBAC_DENIED_VIEWER        → "returns 403 + forbidden for a Viewer token"
 *   UNAUTH                    → "returns 401 when no bearer token is presented"
 *   UNKNOWN_DEVICE            → "returns 404 when the device does not exist"
 *   INVALID_DATE              → "returns 400 when ?since is not ISO-8601"
 *   INVALID_WINDOW            → "returns 400 when ?since is after ?until"
 *   DB_THROW_MID_STREAM       → "does NOT emit a csv_exported audit row on stream error"
 *   CSV_QUOTE_ESCAPE          → "RFC 4180 quoting for values containing commas, quotes, and newlines"
 *
 * Plus a "writes exactly one csv_exported audit row on success"
 * pin so the audit invariant is explicit (covered by every happy
 * path above + dedicated audit-emit assertion).
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { type ReadingRow } from "./csvRepository.js";
import { buildCsvRouter, CSV_MAX_ROWS, type BuildCsvRouterDeps } from "./csvRouter.js";

const STRONG_SECRET = "x".repeat(64);

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";
const DEVICE_MISSING = "9b1c4f00-0000-4000-8000-0000ffffffff";

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const TECH_ID = "00000000-0000-4000-8000-00000000a003";
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";

const tokenForRole = (role: "Admin" | "Operator" | "Technician" | "Viewer"): string => {
  const userIdByRole: Record<typeof role, string> = {
    Admin: ADMIN_ID,
    Operator: OPERATOR_ID,
    Technician: TECH_ID,
    Viewer: VIEWER_ID,
  };
  return issueAccessToken({ userId: userIdByRole[role], role }).token;
};

interface AuditCall {
  readonly auditAction: string;
  readonly userId?: string;
  readonly outcome: string;
  readonly context?: Record<string, unknown>;
}

interface StartArgs {
  readonly audit: AuditLogger;
  readonly auditCalls?: AuditCall[];
  readonly rows?: readonly ReadingRow[];
  readonly deviceExists?: (deviceId: string) => Promise<boolean>;
  readonly streamThrows?: boolean;
  /**
   * Optional override for the production `streamForCsv` factory —
   * lets the TRUNCATED test inject an iterator that yields exactly
   * the cap without materializing 100K rows.
   */
  readonly streamForCsv?: BuildCsvRouterDeps["streamForCsv"];
  readonly maxRows?: number;
  /**
   * Optional injected clock for the `parseWindow` default (F10).
   * Production reads wall-clock `new Date()`; tests inject a
   * frozen `Date` so the 30-day default delta is exact.
   */
  readonly now?: () => Date;
  /**
   * Stub a custom `req.user` shape for the F20 userId-undefined
   * regression test. Production always has an authenticated user
   * (the `authenticate` middleware populates `req.user`); this
   * stub lets the F20 test simulate the "auth regressed" branch.
   */
  readonly stripUser?: boolean;
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  // F20 — `stripUser` middleware runs AFTER `authenticate` so the
  // Bearer token is decoded and `req.user` is populated. We then
  // override `req.user.id` to `undefined` (keeping a valid role so
  // the `authorize` middleware's RBAC gate passes), so the router
  // sees `areq.user?.id === undefined` and falls into the
  // defensive "unknown subject" branch. Production should never
  // reach this branch — the F20 test forces it to prove the
  // audit-row defense.
  if (args.stripUser === true) {
    app.use((req, _res, next) => {
      const u = (req as any).user;
      if (u && typeof u === "object") {
        u.id = undefined;
      }
      next();
    });
  }
  app.use(
    buildCsvRouter({
      audit: args.audit,
      // The `streamForCsv` factory the router calls. Tests can
      // override directly; otherwise the default stub materializes
      // `args.rows`.
      streamForCsv:
        args.streamForCsv ??
        ((_deviceId, _since, _until, _maxRows) =>
          (async function* (): AsyncIterator<ReadingRow> {
            if (args.streamThrows === true) {
              throw new Error("prisma unreachable");
            }
            for (const row of args.rows ?? []) {
              yield row;
            }
          })()),
      deviceExists: args.deviceExists ?? (async (id: string) => id === DEVICE_A || id === DEVICE_B),
      maxRows: args.maxRows,
      now: args.now,
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

beforeEach(() => {
  process.env["JWT_SECRET"] = STRONG_SECRET;
});

afterEach(() => {
  // nothing to clean up; each test owns its server lifecycle.
});

const sampleRows = (n: number): ReadingRow[] => {
  const rows: ReadingRow[] = [];
  const baseMs = 1_700_000_000_000;
  for (let i = 0; i < n; i += 1) {
    rows.push({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      deviceId: DEVICE_A,
      ts: new Date(baseMs + i * 1_000),
      metrics: {
        ph: 7.0 + (i % 10) * 0.01,
        tds_ppm: 100 + i,
        turbidity_ntu: 0.5,
        temp_c: 27.0,
        chlorine_ppm: 0.6,
        water_level_cm: 80,
      },
    });
  }
  return rows;
};

describe("Story 5.2 — GET /api/devices/:deviceId/readings.csv", () => {
  it("streams the CSV for an Operator token (HAPPY_PATH_OPERATOR)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: sampleRows(2),
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-csv-truncated")).toBe("false");
    const body = await res.text();
    // Header + 2 readings × 6 metrics. NO trailer (F15 — trailer
    // moved to `X-CSV-Truncated` header).
    const lines = body.split("\n").filter((l) => l !== "");
    expect(lines[0]).toBe("device_id,ts,metric,value");
    expect(lines.length).toBe(1 + 2 * 6);
    await close();
  });

  it("streams the CSV for an Admin token (HAPPY_PATH_ADMIN)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: sampleRows(1),
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("device_id,ts,metric,value");
    expect(res.headers.get("x-csv-truncated")).toBe("false");
    await close();
  });

  it("returns the header only when the device has zero readings (HAPPY_PATH_EMPTY)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: [],
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    // F15: truncation signal moved into the HTTP header.
    expect(res.headers.get("x-csv-truncated")).toBe("false");
    const body = await res.text();
    const lines = body.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("device_id,ts,metric,value");
    await close();
  });

  it(`sets X-CSV-Truncated: true when the cap+1 detection fires (TRUNCATED)`, async () => {
    // F9 — request cap + 1 from the iterator; cap + 1 means the
    // dataset exceeds the cap, so the truncated flag should fire.
    // Use a small cap (3) so the test runs in <10ms without
    // streaming the production cap (100K) through the test rig.
    // The behavior under test is the `truncated: true` flag flip,
    // not the specific cap value — the production cap is verified
    // separately by reading `CSV_MAX_ROWS` from the module.
    const testCap = 3;
    const calls: AuditCall[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (e) => {
          calls.push({
            auditAction: e.auditAction,
            userId: e.userId,
            outcome: e.outcome,
            context: e.context,
          });
        },
      },
      // Yield ONE row BEYOND the cap so the detection fires.
      streamForCsv: (_deviceId, _since, _until, _maxRows) =>
        (async function* (): AsyncIterator<ReadingRow> {
          const baseMs = 1_700_000_000_000;
          // We yield `cap + 1` rows total so the router's cap+1
          // detection logic can spot the truncation.
          for (let i = 0; i < testCap + 1; i += 1) {
            yield {
              id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              deviceId: DEVICE_A,
              ts: new Date(baseMs + i * 1_000),
              metrics: {
                ph: 7,
                tds_ppm: 100,
                turbidity_ntu: 0.5,
                temp_c: 27,
                chlorine_ppm: 0.6,
                water_level_cm: 80,
              },
            };
          }
        })(),
      maxRows: testCap,
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    // Truncated header flipped to `true` (F15 — header replaces
    // trailer line).
    expect(res.headers.get("x-csv-truncated")).toBe("true");
    const body = await res.text();
    // Body contains exactly `cap` data rows × 6 metrics + the
    // header line. The extra row that triggered truncation was
    // dropped.
    const lines = body.split("\n").filter((l) => l !== "");
    expect(lines.length).toBe(1 + testCap * 6);
    const emit = calls.find((c) => c.auditAction === "csv_exported");
    expect(emit).toBeDefined();
    expect(emit?.context?.["truncated"]).toBe(true);
    expect(emit?.context?.["rowCount"]).toBe(testCap);
    await close();
  });

  it(`sets X-CSV-Truncated: false when the dataset equals the cap exactly (NO_FALSE_POSITIVE_AT_CAP)`, async () => {
    // F9 — the previous `rowCount >= cap` test produced a false
    // positive: an operator with exactly the cap of readings would
    // see `truncated: true` and narrow their window unnecessarily.
    // The cap+1 detection logic now correctly returns `truncated:
    // false` when the dataset is EXACTLY the cap.
    const testCap = 3;
    const calls: AuditCall[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (e) => {
          calls.push({
            auditAction: e.auditAction,
            userId: e.userId,
            outcome: e.outcome,
            context: e.context,
          });
        },
      },
      // Yield EXACTLY `testCap` rows — the dataset ends at the cap.
      streamForCsv: (_deviceId, _since, _until, _maxRows) =>
        (async function* (): AsyncIterator<ReadingRow> {
          const baseMs = 1_700_000_000_000;
          for (let i = 0; i < testCap; i += 1) {
            yield {
              id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              deviceId: DEVICE_A,
              ts: new Date(baseMs + i * 1_000),
              metrics: {
                ph: 7,
                tds_ppm: 100,
                turbidity_ntu: 0.5,
                temp_c: 27,
                chlorine_ppm: 0.6,
                water_level_cm: 80,
              },
            };
          }
        })(),
      maxRows: testCap,
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    // Truncation must NOT flip when the dataset is exactly cap.
    expect(res.headers.get("x-csv-truncated")).toBe("false");
    const emit = calls.find((c) => c.auditAction === "csv_exported");
    expect(emit?.context?.["truncated"]).toBe(false);
    expect(emit?.context?.["rowCount"]).toBe(testCap);
    await close();
  });

  it("returns 403 + forbidden for a Technician token (RBAC_DENIED_TECH)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; required_role: string };
    expect(body.error).toBe("forbidden");
    expect(body.required_role).toBe("Operator");
    await close();
  });

  it("returns 403 + forbidden for a Viewer token (RBAC_DENIED_VIEWER)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
    await close();
  });

  it("returns 401 when no bearer token is presented (UNAUTH)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`);
    expect(res.status).toBe(401);
    await close();
  });

  it("returns 404 when the device does not exist (UNKNOWN_DEVICE)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: [],
      deviceExists: async () => false,
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_MISSING}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
    await close();
  });

  it("returns 400 when ?since is not ISO-8601 (INVALID_DATE)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv?since=not-a-date`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("returns 400 when ?since is after ?until (INVALID_WINDOW)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(
      `${url}/api/devices/${DEVICE_A}/readings.csv?since=2026-08-01T00:00:00.000Z&until=2026-07-01T00:00:00.000Z`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("does NOT emit a csv_exported audit row on stream error (DB_THROW_MID_STREAM)", async () => {
    const calls: AuditCall[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (e) => {
          calls.push({
            auditAction: e.auditAction,
            userId: e.userId,
            outcome: e.outcome,
            context: e.context,
          });
        },
      },
      rows: sampleRows(1),
      streamThrows: true,
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    // Connection closes mid-stream; the client sees status 200 with
    // a partial body (the headers + an unterminated stream). The
    // important invariant is: no csv_exported row was written.
    expect(res.status).toBe(200);
    // Wait for the response to settle so any async audit emit fires.
    await res.text();
    const csvEmits = calls.filter((c) => c.auditAction === "csv_exported");
    expect(csvEmits).toHaveLength(0);
    // rbac_allowed should still have fired (authorize runs before the
    // handler); csv_exported should NOT have fired.
    const rbacAllowed = calls.filter((c) => c.auditAction === "rbac_allowed");
    expect(rbacAllowed.length).toBeGreaterThanOrEqual(1);
    await close();
  });

  it("RFC 4180 quoting for values containing commas, quotes, newlines, and CRs (CSV_QUOTE_ESCAPE)", async () => {
    // F1 — pin the helper end-to-end through the router. The
    // 6 canonical numeric metrics never exercise the escape path,
    // but a v2 device with extra metric keys whose values contain
    // `"`, `,`, `\n`, or `\r` does. The router now iterates
    // `Object.entries(row.metrics)` (F11) and applies `encodeCsvCell`
    // to every value, so a synthetic row with v2 keys containing
    // the three RFC 4180 triggers produces wire-shape-quoted CSV
    // lines.
    //
    // The row's 6 v1 metrics are kept valid (number-typed, in
    // range) so `TelemetryMetricsSchema.safeParse` (F12) passes —
    // the row would be skipped if validation failed.
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          deviceId: DEVICE_A,
          ts: new Date("2026-08-01T00:00:00.000Z"),
          metrics: {
            ph: 7.0,
            tds_ppm: 100,
            turbidity_ntu: 0.5,
            temp_c: 27.0,
            chlorine_ppm: 0.6,
            water_level_cm: 80,
            // v2 forward-compat keys with special-char values that
            // exercise the RFC 4180 escape path. Cast through
            // `unknown` so the additional keys bypass the strict
            // `TelemetryMetrics` type but are still iterable by the
            // serializer (F11).
            note_with_quote: 'a"b' as any,
            tag_with_comma: "x,y" as any,
            label_with_newline: "a\nb" as any,
            label_with_cr: "a\rb" as any,
          } as unknown as ReadingRow["metrics"],
        },
      ],
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    // RFC 4180 quoting patterns:
    //   - `a"b`     → `"a""b"`     (doubled quote).
    //   - `x,y`     → `"x,y"`      (comma forces quote-wrap).
    //   - `a\nb`    → `"a<NL>b"`   (newline forces quote-wrap).
    //   - `a\rb`    → `"a<CR>b"`   (CR forces quote-wrap).
    expect(body).toContain('"a""b"');
    expect(body).toContain('"x,y"');
    expect(body).toContain('"a\nb"');
    expect(body).toContain('"a\rb"');
    await close();
  });

  it("emits exactly one csv_exported audit row with the expected payload on success", async () => {
    const calls: AuditCall[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (e) => {
          calls.push({
            auditAction: e.auditAction,
            userId: e.userId,
            outcome: e.outcome,
            context: e.context,
          });
        },
      },
      rows: sampleRows(3),
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    await res.text();
    const csvEmits = calls.filter((c) => c.auditAction === "csv_exported");
    expect(csvEmits).toHaveLength(1);
    const emit = csvEmits[0]!;
    expect(emit.outcome).toBe("success");
    expect(emit.userId).toBe(OPERATOR_ID);
    expect(emit.context).toBeDefined();
    expect(emit.context?.["subject"]).toBe(DEVICE_A);
    expect(emit.context?.["rowCount"]).toBe(3);
    expect(emit.context?.["truncated"]).toBe(false);
    expect(typeof emit.context?.["since"]).toBe("string");
    expect(typeof emit.context?.["until"]).toBe("string");
    await close();
  });

  it("writes the Content-Disposition filename derived from deviceId + since date", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: [],
    });
    const res = await fetch(
      `${url}/api/devices/${DEVICE_B}/readings.csv?since=2026-08-01T00:00:00.000Z`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition");
    expect(disposition).toBe(`attachment; filename="device-${DEVICE_B}-readings-2026-08-01.csv"`);
    await close();
  });

  it("defaults to a 30-day window when ?since is omitted (frozen clock)", async () => {
    // F10 — pin the 30-day default against a frozen clock so the
    // assertion is exact, not "approximately 30 days". The previous
    // version read wall-clock `new Date()` inside `parseWindow`,
    // which made the test timing-fragile (a millisecond slop could
    // produce a 29.999... day delta on a busy CI box).
    const frozenNow = new Date("2026-09-01T00:00:00Z");
    const calls: AuditCall[] = [];
    const { url, close } = await startApp({
      audit: {
        emit: (e) => {
          calls.push({
            auditAction: e.auditAction,
            userId: e.userId,
            outcome: e.outcome,
            context: e.context,
          });
        },
      },
      rows: [],
      now: () => frozenNow,
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    await res.text();
    const emit = calls.find((c) => c.auditAction === "csv_exported");
    expect(emit).toBeDefined();
    const since = new Date(emit!.context!["since"] as string);
    const until = new Date(emit!.context!["until"] as string);
    expect(since.getTime()).toBe(frozenNow.getTime() - 30 * 24 * 60 * 60 * 1_000);
    expect(until.getTime()).toBe(frozenNow.getTime());
    await close();
  });

  it("returns 400 when ?since is date-only (no TZ marker) (F6)", async () => {
    // F6 — `2026-08-01` parses to UTC midnight in V8 but
    // `2026-08-01T00:00:00` (no offset) parses to LOCAL midnight;
    // accepting one but rejecting the other would mean the same
    // operator input produces different windows on different
    // machines. Reject BOTH for unambiguous cross-machine
    // semantics.
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv?since=2026-08-01`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("returns 400 when ?since is local-time-no-offset (F6)", async () => {
    // F6 — `2026-08-01T00:00:00` lacks `Z` and lacks a numeric
    // offset; V8 would interpret this as local time which shifts
    // between CI boxes. Reject.
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
    });
    const res = await fetch(
      `${url}/api/devices/${DEVICE_A}/readings.csv?since=2026-08-01T00:00:00`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
    await close();
  });

  it("accepts ?since with a trailing Z (F6)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: [],
    });
    const res = await fetch(
      `${url}/api/devices/${DEVICE_A}/readings.csv?since=2026-08-01T00:00:00Z`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(200);
    await close();
  });

  it("accepts ?since with a numeric +06:00 offset (F6)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      rows: [],
    });
    const res = await fetch(
      `${url}/api/devices/${DEVICE_A}/readings.csv?since=2026-08-01T00:00:00%2B06:00`,
      { headers: { Authorization: `Bearer ${tokenForRole("Admin")}` } },
    );
    expect(res.status).toBe(200);
    await close();
  });

  it("returns 500 when deviceExists throws a non-P2025 prisma error (F7)", async () => {
    // F7 — a DB outage previously surfaced as a misleading 404
    // because `buildPrismaDeviceExists` swallowed every error. The
    // router should turn any non-`P2025` (non not-found) error
    // into a 500 so the operator's "device missing?" investigation
    // is not thrown off track.
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      deviceExists: async () => {
        // Simulate a non-P2025 prisma error (DB outage).
        const err = new Error("prisma unreachable") as Error & { code?: string };
        throw err;
      },
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("internal_error");
    await close();
  });

  it("still emits the audit row when req.user.id is undefined (F20)", async () => {
    // F20 — defensive path. `authenticate` middleware normally
    // populates `req.user.id` BEFORE the router runs; this test
    // strips the user so the router sees `areq.user?.id ===
    // undefined`. The audit row should still be emitted (with
    // `subject: "unknown"`) rather than silently dropped, so the
    // operator's export stays traceable when the auth seam
    // regresses.
    //
    // The test rig's `stripUser` middleware runs BEFORE
    // `authenticate` — but `authenticate` always re-populates
    // `req.user` from the Bearer token. To force the
    // router-side "user undefined" branch, we strip the user in
    // a POST-authenticate middleware (placed between
    // `authenticate` and the csv router). The simpler test
    // (no strip) exercises the production path; the strip
    // variant is the explicit F20 defensive pin.
    const calls: AuditCall[] = [];
    const { url, close } = await startApp({
      stripUser: true,
      audit: {
        emit: (e) => {
          calls.push({
            auditAction: e.auditAction,
            userId: e.userId,
            outcome: e.outcome,
            context: e.context,
          });
        },
      },
      rows: sampleRows(1),
    });
    const res = await fetch(`${url}/api/devices/${DEVICE_A}/readings.csv`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    await res.text();
    const csvEmits = calls.filter((c) => c.auditAction === "csv_exported");
    // The audit row is emitted regardless of the user-strip path.
    expect(csvEmits.length).toBeGreaterThanOrEqual(1);
    // The F20 strip branch: `req.user.id === undefined` (the
    // stripUser middleware sets `u.id = undefined` so the
    // `authorize` RBAC gate still passes — `user !== null` —
    // while the router sees `user.id === undefined`). The
    // defensive `subject: "unknown"` fallback fires; the audit
    // row's `userId` is also undefined (the auth regression).
    const last = csvEmits[csvEmits.length - 1]!;
    expect(last.userId).toBeUndefined();
    expect(last.context?.["subject"]).toBe("unknown");
    await close();
  });

  it("exposes the production row cap as 100,000 rows", () => {
    // Documents the production cap (Story 5.2 spec: "Capped at
    // 100,000 rows per request"). If a future contributor lowers
    // this constant without revisiting the spec, this pin fails.
    expect(CSV_MAX_ROWS).toBe(100_000);
  });
});
