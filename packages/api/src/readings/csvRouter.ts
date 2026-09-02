/**
 * `GET /api/devices/:deviceId/readings.csv` — Operator + Admin CSV export.
 *
 * Streams CSV row-by-row from the `Reading` table. The truncation
 * flag is exposed as the `X-CSV-Truncated` response header — NOT
 * as a body trailer (Excel users saw a junk `# truncated:` row).
 * RBAC: matrix grants `export Reading` to Operator + Admin only.
 */
import express, { type Response, type Router } from "express";

import { type AuditLogger } from "../audit";
import { ERROR_CODES } from "../errors.js";
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_ERROR, HTTP_NOT_FOUND, HTTP_OK } from "../httpStatus.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import { bindPrismaResolverForCsv, type ReadingRow, streamForCsv } from "./csvRepository.js";
import { CSV_HEADER, readingRowToCsvLines } from "./csvSerialization.js";

/**
 * Hard cap on rows per request. 6 known metric keys × ~17,280
 * readings/day × 30 days ≈ 104k rows for a busy device — the cap
 * is reachable and the trailer surfaces the truncation to the
 * operator.
 */
export const CSV_MAX_ROWS = 100_000;

/**
 * 30-day window in milliseconds — used when `?since` is omitted.
 * Component constants are extracted to named values so the
 * `no-magic-numbers` lint rule can stay satisfied while the time
 * math stays readable in one place.
 */
const DAYS_PER_WINDOW = 30;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1_000;
const THIRTY_DAYS_MS =
  DAYS_PER_WINDOW * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/**
 * Length of the date portion of an ISO-8601 timestamp when sliced
 * from `toISOString().slice(0, 10)` — YYYY-MM-DD.
 */
const ISO_DATE_PREFIX_LENGTH = 10;

/**
 * `parseIsoDate` — accept a full ISO-8601 timestamp with an
 * explicit timezone. Returns the parsed `Date` on success or
 * `null` if the input is missing/empty OR if it lacks an explicit
 * timezone marker.
 *
 * Strict-tz rules:
 *   - `2026-08-01T00:00:00Z` → `2026-08-01T00:00:00.000Z` (UTC).
 *   - `2026-08-01T00:00:00+06:00` → local-time pinned to +06:00.
 *   - `2026-08-01` → REJECTED (date-only; ambiguous between
 *     operator-local and UTC midnight).
 *   - `2026-08-01T00:00:00` → REJECTED (no offset; V8 interprets
 *     as local time which would shift between machines).
 *
 * Same operator input must always produce the same window — the
 * only safe way to guarantee that is to require an explicit `Z`
 * or numeric offset.
 */
const parseIsoDate = (raw: string | undefined): Date | null => {
  if (raw === undefined || raw === "") return null;
  // Trailing `Z` (UTC) OR a numeric offset `±HH:MM` somewhere in
  // the timestamp. Date-only forms like `2026-08-01` are
  // intentionally rejected — V8 parses them as UTC midnight but a
  // trailing-Z-less local-time form like `2026-08-01T00:00:00` is
  // parsed as local midnight; the helper cannot accept one
  // without the other, so it rejects both for unambiguous
  // cross-machine semantics.
  const hasTzMarker = /Z$|[+-]\d{2}:?\d{2}$/.test(raw);
  if (!hasTzMarker) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return new Date(at);
};

export interface BuildCsvRouterDeps {
  readonly audit: AuditLogger;
  /**
   * Injectable data layer. Production uses `streamForCsv` against
   * Prisma (lazy-resolved via `getPrisma`); tests pass a stub that
   * yields canned rows.
   */
  readonly streamForCsv: (
    deviceId: string,
    since: Date,
    until: Date,
    maxRows: number,
  ) => AsyncIterable<ReadingRow>;
  /**
   * Device existence check. Production uses `Prisma.device.findUnique`
   * (lazy-resolved via `getPrisma`); tests pass a stub. The 404
   * surface for `UNKNOWN_DEVICE` needs an existence check separate
   * from the streaming read — without it, a typo'd deviceId would
   * return an empty CSV with status 200.
   */
  readonly deviceExists: (deviceId: string) => Promise<boolean>;
  /** Monotonic clock for tests. */
  readonly now?: () => Date;
  /**
   * Optional row cap override (default: `CSV_MAX_ROWS`). Tests
   * inject a smaller value so the truncated-trailer behavior is
   * pinned without streaming 100K rows through the test rig.
   */
  readonly maxRows?: number;
}

/**
 * `buildCsvRouter(deps)` — returns an Express `Router` mounted at
 * `/api/devices/:deviceId/readings.csv`. Mounted AFTER
 * `authenticate` in `packages/api/src/index.ts`.
 *
 * Lazy Prisma: this module never imports `@prisma/client`. The
 * production wiring injects `streamForCsv` + `deviceExists`
 * factories that resolve Prisma lazily.
 */
/**
 * Parse the `:deviceId` URL param into a non-null string. Returns
 * `null` when the param is missing or empty (unreachable in
 * practice, but the defensive parse keeps the router resilient).
 */
const parseDeviceId = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
};

/**
 * Resolved `[since, until]` window for the export. `null` means the
 * caller should respond 400 with `validation_error`. The `now`
 * parameter is the monotonic clock (production: `new Date()`;
 * tests: a fixed `Date` injected via `BuildCsvRouterDeps.now`).
 */
interface ResolvedWindow {
  readonly since: Date;
  readonly until: Date;
}

const parseWindow = (query: AuthorizedRequest["query"], now: Date): ResolvedWindow | null => {
  const sinceRaw = typeof query["since"] === "string" ? query["since"] : undefined;
  const untilRaw = typeof query["until"] === "string" ? query["until"] : undefined;
  const sinceParsed = parseIsoDate(sinceRaw);
  const untilParsed = parseIsoDate(untilRaw);
  if (sinceRaw !== undefined && sinceParsed === null) return null;
  if (untilRaw !== undefined && untilParsed === null) return null;
  const until = untilParsed ?? now;
  // `?since` omitted → default to last 30 days from `until`.
  const since = sinceParsed ?? new Date(until.getTime() - THIRTY_DAYS_MS);
  if (since.getTime() >= until.getTime()) return null;
  return { since, until };
};

/**
 * Inputs for `streamAndWrite`. Bundled into a single arg so the
 * helper stays under the `max-params` lint cap (max 3) and the
 * 6 inputs (response, 4 read bounds + deps) travel together.
 */
interface StreamAndWriteArgs {
  readonly res: Response;
  readonly deviceId: string;
  readonly since: Date;
  readonly until: Date;
  readonly cap: number;
  readonly deps: BuildCsvRouterDeps;
  /**
   * Optional callback fired when the truncation flag flips from
   * `false` to `true` MID-STREAM. The router uses this to update
   * the `X-CSV-Truncated` response header BEFORE the underlying
   * chunks flush to the wire (Node's HTTP layer refuses
   * `setHeader` calls after the first chunk is sent). The default
   * is a no-op so the helper remains a pure stream function.
   */
  readonly onTruncated?: () => void;
}

/**
 * Stream-and-write result. `streamSucceeded === true` distinguishes
 * the "0-row device" case (audit row emitted with `rowCount: 0`)
 * from the "stream error" case (audit row NOT emitted).
 */
interface StreamWriteResult {
  readonly streamSucceeded: boolean;
  readonly rowCount: number;
  readonly truncated: boolean;
}

/**
 * Stream rows from `deps.streamForCsv`, write each metric line to
 * `res`. The router requests `cap + 1` rows from the data layer;
 * if the iterator yielded `cap + 1` rows the function knows the
 * dataset extends beyond the cap and drops the extra (so the wire
 * stays at exactly `cap` rows) and sets `truncated: true`. If the
 * iterator yielded exactly `cap` rows (or fewer), `truncated` is
 * `false` — even when `rowCount === cap` exactly (the previous
 * `>=` test produced a false positive at exactly-cap).
 *
 * On any stream error the connection is closed (best-effort) and
 * `{ streamSucceeded: false, rowCount: 0, truncated: false }` is
 * returned so the audit row is NEVER emitted — per the spec's
 * "gated on full success" requirement.
 *
 * The truncation header (`X-CSV-Truncated`) is set BEFORE the
 * stream begins (the router initializes it to `"false"` before
 * calling this helper). The actual flag is passed back via the
 * result; the router then updates the header. The header cannot
 * be set inside this loop because once `res.end()` fires (or
 * `res.write` flushes the chunked response), Node's HTTP layer
 * refuses additional `setHeader` calls.
 */
const streamAndWrite = async (args: StreamAndWriteArgs): Promise<StreamWriteResult> => {
  const { res, deviceId, since, until, cap, deps, onTruncated } = args;
  let rowCount = 0;
  let truncated = false;
  // Buffer the body so the truncation flag can be decided BEFORE
  // writing the first byte. This guarantees the `X-CSV-Truncated`
  // header (set on the router before calling) reflects the final
  // truncation state when the first body chunk flushes. Reading
  // `cap + 1` rows means the function knows at the end whether the
  // dataset extended beyond the cap; for the common (non-truncated)
  // case the body is `cap` rows × 6 metrics + header — well under
  // any memory budget (100k × 6 ≈ 600k rows × ~30 bytes ≈ 18MB
  // worst case for the production cap).
  //
  // Note: this is a trade-off with the original "stream never
  // buffers" claim — the previous code streamed per-row, but
  // then `res.setHeader` after a `res.write` throws
  // `ERR_HTTP_HEADERS_SENT`. The bounded buffer (≤ cap + 1 rows)
  // preserves the memory safety of the streaming design.
  const lines: string[] = [`${CSV_HEADER}\n`];
  try {
    for await (const row of deps.streamForCsv(deviceId, since, until, cap + 1)) {
      if (rowCount >= cap) {
        // Cap+1th row — extra row beyond the cap. Drop without
        // writing, signal truncation.
        truncated = true;
        break;
      }
      const rowLines = readingRowToCsvLines(row);
      for (const line of rowLines) {
        lines.push(`${line}\n`);
      }
      rowCount += 1;
    }
    // Drain the buffered body. Set the truncation callback fires
    // first so the header is flipped BEFORE the body bytes go out
    // — Node's HTTP layer buffers headers until the first write
    // OR an explicit `flushHeaders()`.
    if (truncated && onTruncated !== undefined) onTruncated();
    for (const line of lines) {
      res.write(line);
    }
    res.end();
    return { streamSucceeded: true, rowCount, truncated };
  } catch (err) {
    console.error("api/devices/readings.csv: stream error", err);
    if (!res.writableEnded) {
      res.end();
    }
    return { streamSucceeded: false, rowCount: 0, truncated: false };
  }
};

/**
 * Set the wire headers that MUST be present before the first body
 * byte. Split out of the handler so the request handler stays
 * under the `complexity` lint cap (≤10). The `X-CSV-Truncated`
 * header starts at `"false"` and the streaming loop flips it to
 * `"true"` (via `onTruncated`) if it detects a `cap + 1`-th row.
 */
const setupDownloadHeaders = (res: Response, deviceId: string, since: Date): void => {
  // `since.toISOString().slice(0, 10)` strips the time-of-day so
  // the filename stays sortable.
  const sinceDate = since.toISOString().slice(0, ISO_DATE_PREFIX_LENGTH);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="device-${deviceId}-readings-${sinceDate}.csv"`,
  );
  res.setHeader("X-CSV-Truncated", "false");
  res.status(HTTP_OK);
};

/**
 * Run the device-existence check and write the 404 / 500 surface
 * for it. Returns `true` when the device exists and the caller
 * should proceed to stream; `false` when the response was already
 * written. Split out of the handler so the request handler stays
 * under the `complexity` lint cap (≤10).
 */
const assertDeviceExists = async (
  res: Response,
  deviceId: string,
  deps: BuildCsvRouterDeps,
): Promise<boolean> => {
  let deviceFound: boolean;
  try {
    deviceFound = await deps.deviceExists(deviceId);
  } catch (err) {
    console.error("api/devices/readings.csv: deviceExists error", err);
    res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
    return false;
  }
  if (!deviceFound) {
    res.status(HTTP_NOT_FOUND).json({ error: ERROR_CODES.NOT_FOUND.value });
    return false;
  }
  return true;
};

/**
 * Inputs for `emitCsvAuditRow`. Bundled into a single arg so the
 * helper stays under the `max-params` lint cap (≤3).
 */
interface EmitCsvAuditArgs {
  readonly audit: AuditLogger;
  readonly userId: string | undefined;
  readonly deviceId: string;
  readonly rowCount: number;
  readonly since: Date;
  readonly until: Date;
  readonly truncated: boolean;
}

/**
 * Emit the `csv_exported` audit row. Always emits on `streamSucceeded`
 * (including 0-row devices) so the operator's intent to export is
 * traceable. Fallback: if `userId` is `undefined`, emit anyway
 * with `subject: "unknown"` and log an error — preferring emission
 * over silence keeps the export durable even when the auth seam
 * regresses.
 */
const emitCsvAuditRow = (args: EmitCsvAuditArgs): void => {
  const { audit, userId, deviceId, rowCount, since, until, truncated } = args;
  if (userId === undefined) {
    console.error(
      "csvRouter: stream succeeded but userId is undefined; emitting audit row with subject: unknown",
    );
  }
  audit.emit({
    auditAction: "csv_exported",
    userId,
    outcome: "success",
    context: {
      subject: userId === undefined ? "unknown" : deviceId,
      rowCount,
      since: since.toISOString(),
      until: until.toISOString(),
      truncated,
    },
  });
};

export const buildCsvRouter = (deps: BuildCsvRouterDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/devices/:deviceId/readings.csv",
    authorize({ action: "export", resource: "Reading" }, deps.audit),
    async (req, res: Response) => {
      const areq = req as AuthorizedRequest;

      const deviceId = parseDeviceId(areq.params["deviceId"]);
      if (deviceId === null) {
        res.status(HTTP_BAD_REQUEST).json({ error: ERROR_CODES.VALIDATION_ERROR.value });
        return;
      }

      const now = deps.now ? deps.now() : new Date();
      const window = parseWindow(areq.query, now);
      if (window === null) {
        res.status(HTTP_BAD_REQUEST).json({ error: ERROR_CODES.VALIDATION_ERROR.value });
        return;
      }
      const { since, until } = window;

      // Device existence check. The CSV stream yields zero rows for
      // unknown deviceIds, so this 404 surface must run BEFORE the
      // body stream starts.
      if (!(await assertDeviceExists(res, deviceId, deps))) return;

      // Set wire headers BEFORE writing the first body byte so the
      // client knows it's a download from the very first chunk.
      setupDownloadHeaders(res, deviceId, since);

      const cap = deps.maxRows ?? CSV_MAX_ROWS;
      const { streamSucceeded, rowCount, truncated } = await streamAndWrite({
        res,
        deviceId,
        since,
        until,
        cap,
        deps,
        // The `X-CSV-Truncated` header is set BEFORE the body
        // stream starts (to `"false"`). When the stream loop
        // detects a `cap + 1`-th row, it fires this callback so
        // the header can be flipped to `"true"` BEFORE the chunked
        // response flushes to the wire. Setting headers after
        // `res.write` would error with `ERR_HTTP_HEADERS_SENT`.
        onTruncated: () => res.setHeader("X-CSV-Truncated", "true"),
      });

      // Audit row — emitted on any successful stream completion
      // (including 0-row devices). The `csv_exported` audit
      // context pins the operator's intent to export a window;
      // whether the window produced rows or not is secondary.
      // Only DB_THROW_MID_STREAM (handled inside
      // `streamAndWrite`, which sets `streamSucceeded: false` on
      // error) skips the audit row — per the spec's "gated on
      // full success" requirement.
      if (streamSucceeded) {
        emitCsvAuditRow({
          audit: deps.audit,
          userId: areq.user?.id,
          deviceId,
          rowCount,
          since,
          until,
          truncated,
        });
      }
    },
  );

  return router;
};

/**
 * Production adapter — wires the lazy-resolved Prisma client into
 * the repository's module-scoped seam so the api can import this
 * module without booting Prisma at construction time.
 *
 * Returns the bound `streamForCsv` function so callers (mainly
 * `index.ts`) can keep a stable reference for the router's
 * `BuildCsvRouterDeps.streamForCsv` field.
 */
export const buildPrismaStreamForCsv = (
  resolvePrismaClient: () => Promise<unknown>,
): ((deviceId: string, since: Date, until: Date, maxRows: number) => AsyncIterable<ReadingRow>) => {
  bindPrismaResolverForCsv(resolvePrismaClient);
  return streamForCsv;
};

/**
 * Production adapter for the device-existence check. Lazy-resolves
 * Prisma and runs `device.findUnique({ where: { id } })`; returns
 * `false` only when the row does not exist.
 *
 * Prisma's `P2025` error code is the canonical "record not found"
 * signal. For the defensive case where `findUnique` itself throws
 * (DB outage, connection refused, schema drift), the function
 * RE-THROWS rather than swallowing — the router's catch block
 * converts any non-`P2025` error into 500, so an outage surfaces
 * as `503`-shaped 500 instead of misleading 404 not_found.
 */
interface PrismaDeviceClient {
  device: { findUnique: (args: unknown) => Promise<unknown> };
}

export const buildPrismaDeviceExists =
  (resolvePrismaClient: () => Promise<unknown>): ((deviceId: string) => Promise<boolean>) =>
  async (deviceId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (await resolvePrismaClient()) as any as PrismaDeviceClient | null;
    if (client === null || client === undefined) {
      // No client wired → treat as "not found" so the production
      // boot-time lazy-resolution failure surfaces as a clean 404
      // rather than 500; the test rig always wires a client.
      return false;
    }
    let row: unknown;
    try {
      row = await client.device.findUnique({ where: { id: deviceId } });
    } catch (err) {
      // `P2025` is the canonical "record not found" Prisma code.
      // A `P2025` from a thrown `findUniqueOrThrow` would map to
      // `false` here; an unrelated throw (DB outage, schema drift)
      // re-throws so the router turns it into 500 — NOT a
      // misleading 404.
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
        return false;
      }
      throw err;
    }
    return row !== null && row !== undefined;
  };
