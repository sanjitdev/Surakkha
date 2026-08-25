/**
 * Pure helpers extracted from `seed.ts` so the seed's `deriveName`
 * and `assertValidScenario` (Story 2.5) AND `upsertDefaultRule`
 * (Story 3.3) can be unit-tested without booting Prisma or risking
 * `process.exit`.
 *
 * Anything that touches the filesystem, Prisma, or `process.exit`
 * stays in `seed.ts`.
 */

import { Prisma, type PrismaClient, type Rule } from "@prisma/client";
import { SCENARIO_NAMES, type ScenarioName } from "@surakkha/shared/simulator";

import { assertValidSeedRow, type RuleSeedRow } from "./thresholdTable.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_TAIL_HEX_CHARS = 4;

/**
 * Derive a stable v1 placeholder name from a UUIDv4 device_id's last
 * 4 hex digits.
 *
 * - UUIDv4 format enforced (8-4-4-4-12 with version 4 + variant 8/9/a/b).
 * - Last-4-hex keeps labels unique across UUIDv4 distributions
 *   (two UUIDv4s share a 4-char tail with probability 2^-16).
 * - Hex letters are uppercased so the admin tab label is canonical.
 * - Throws on empty / malformed input so a typo'd `devices.json`
 *   never lands a junk label in the DB.
 */
export const deriveName = (deviceId: string): string => {
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw new Error(
      `seed: device_id must be a non-empty UUIDv4 string: ${deviceId}`,
    );
  }
  if (!UUID_V4_PATTERN.test(deviceId)) {
    throw new Error(
      `seed: device_id must be a valid UUIDv4 (8-4-4-4-12 with v4 / variant 8-b): ${deviceId}`,
    );
  }
  const tail = deviceId.slice(-NAME_TAIL_HEX_CHARS).toUpperCase();
  return `DEVICE-${tail}`;
};

/**
 * Assert that a scenario name is one of the seven documented names.
 * Throws otherwise so a typo'd `devices.json` never lands a value the
 * api's input validator would later reject.
 */
export const assertValidScenario = (
  scenario: string,
): asserts scenario is ScenarioName => {
  if (!(SCENARIO_NAMES as readonly string[]).includes(scenario)) {
    throw new Error(
      `seed: invalid scenario "${scenario}" (must be one of: ${SCENARIO_NAMES.join(", ")})`,
    );
  }
};

/**
 * Per-device row from `devices.json`. The seed reads `lat` / `lng`
 * optionally so a partially-shaped JSON still loads cleanly (Story
 * 2.7 added the columns; the values default to undefined when
 * absent).
 */
export interface DevicesJsonEntry {
  readonly device_id: string;
  readonly scenario: string;
  readonly lat?: number;
  readonly lng?: number;
}

/**
 * Build the `update` payload for `prisma.device.upsert`. Returns an
 * object whose keys are only the nullable columns that the existing
 * row has not yet filled — a runtime-named device or a runtime-set
 * scenario persists across re-runs.
 *
 * Pure: takes the existing row projection + the parsed entry; no
 * Prisma / filesystem / global access.
 */
export const buildDeviceUpdateFields = (
  existing: {
    readonly name: string | null;
    readonly scenario: string | null;
    readonly lat: number | null;
    readonly lng: number | null;
  } | null,
  entry: DevicesJsonEntry,
  deriveNameFn: (id: string) => string,
): {
  name?: string;
  scenario?: string;
  lat?: number;
  lng?: number;
} => {
  const fields: {
    name?: string;
    scenario?: string;
    lat?: number;
    lng?: number;
  } = {};
  if (existing?.name === null) fields.name = deriveNameFn(entry.device_id);
  if (existing?.scenario === null) fields.scenario = entry.scenario;
  return appendCoordinates(fields, entry, existing);
};

/**
 * Helper extracted from `buildDeviceUpdateFields` so the per-cell
 * decision tree stays below the eslint complexity cap.
 */
const appendCoordinates = (
  fields: {
    name?: string;
    scenario?: string;
    lat?: number;
    lng?: number;
  },
  entry: DevicesJsonEntry,
  existing: {
    readonly lat: number | null;
    readonly lng: number | null;
  } | null,
): {
  name?: string;
  scenario?: string;
  lat?: number;
  lng?: number;
} => {
  if (existing?.lat !== null || existing?.lng !== null) return fields;
  if (entry.lat === undefined || entry.lng === undefined) return fields;
  return { ...fields, lat: entry.lat, lng: entry.lng };
};

// ---------------------------------------------------------------------------
// Story 3.3 — Rule upsert helpers
// ---------------------------------------------------------------------------

/**
 * Return shape of {@link upsertDefaultRule}. Three terminal statuses:
 *   - "created"          — the row did not exist; we inserted it.
 *   - "noop"             — the row existed with matching shape; the
 *                          `update: {}` no-op kept it intact (AC3
 *                          idempotency).
 *   - "skipped-inactive" — the row existed at the unique key but with
 *                          `isActive: false` (Story 3.7 admin took
 *                          over with a sibling `version: 2` row); we
 *                          preserved the row as-is (AC6) and never
 *                          resurrected the original.
 */
export interface UpsertDefaultRuleResult {
  readonly status: "created" | "noop" | "skipped-inactive";
}

/**
 * Drift-checked field set. The seed OWNS these fields on every Rule v1
 * row; any divergence in this set after a successful upsert means a
 * Story 3.7 admin edit (or some other write) drifted the row's shape
 * and we refuse to silently overwrite.
 *
 * Intentionally NOT drift-checked: `createdAt` / `updatedAt`
 * (server-generated), `version` (part of the unique key — always 1),
 * `isActive` (the admin-takeover signal — `false` is a valid state),
 * `createdBy` (forward-compat for the User migration; the seed does
 * not own the column today), and `id` (server-generated UUID).
 */
export const DRIFT_CHECKED_FIELDS = [
  "metric",
  "operator",
  "threshold",
  "severity",
  "ruleType",
  "minDurationSeconds",
  "hysteresisSeconds",
] as const satisfies ReadonlyArray<keyof Rule>;

export type DriftCheckedField = (typeof DRIFT_CHECKED_FIELDS)[number];

/**
 * Project the existing row's drift-checked fields into a plain object.
 * Used by {@link upsertDefaultRule} to render the `existing=` half of
 * the drift-error message so a developer reading the error can see
 * the actual drifted shape.
 */
export const pickDriftShape = (
  row: Rule,
): Record<DriftCheckedField, unknown> => ({
  metric: row.metric,
  operator: row.operator,
  threshold: row.threshold,
  severity: row.severity,
  ruleType: row.ruleType,
  minDurationSeconds: row.minDurationSeconds,
  hysteresisSeconds: row.hysteresisSeconds,
});

/**
 * Project the desired row's drift-checked fields into a plain object.
 * Used by {@link upsertDefaultRule} to render the `desired=` half of
 * the drift-error message. Permanent seed invariants (`ruleType:
 * "instant"`, `minDurationSeconds: 0`, `hysteresisSeconds: 0`) are
 * hardcoded so a typo can't drift the desired shape.
 */
export const desiredDriftShape = (
  row: RuleSeedRow,
): Record<DriftCheckedField, unknown> => ({
  metric: row.metric,
  operator: row.operator,
  threshold: row.threshold,
  severity: row.severity,
  ruleType: "instant",
  minDurationSeconds: 0,
  hysteresisSeconds: 0,
});

/**
 * 2ms tolerance window for created-vs-noop detection.
 *
 * Per loopback-2 F2: Prisma 5.x's `@updatedAt` may fire on insert
 * within the same transaction's wall-clock read, misclassifying a
 * fresh row as `noop` and zeroing the summary's `createdCount`.
 * The 2ms window covers clock granularity across Postgres + Node
 * without admitting legitimate mid-second updates.
 */
const FRESH_TIMESTAMP_TOLERANCE_MS = 2;

/**
 * Upsert a single FR-13 default rule at the seed-managed `version: 1`
 * key. Wraps `prisma.rule.upsert` so:
 *   - the natural `@@unique([deviceId, metric, operator, threshold, version])`
 *     key is the only authority for "did we see this row before";
 *   - the `update: {}` no-op means a re-run on the same DB is a true
 *     no-op (AC3 — `prisma.rule.update` is NEVER called);
 *   - a concurrent second seed run races on the unique key and
 *     surfaces as `P2002`, which we re-throw with a wrapped message
 *     rather than leaking a raw Prisma stack trace;
 *   - a Story 3.7 admin edit that drifts the existing row's shape
 *     (e.g. severity flips from `critical` to `warning`) throws the
 *     documented `seed: existing Rule row ... has different shape ...`
 *     error rather than silently overwriting (AC5);
 *   - a Story 3.7 admin edit that flips `isActive: false` on the
 *     `version: 1` row (with a sibling `version: 2` `isActive: true`
 *     row) is preserved as-is and the helper returns
 *     `{ status: "skipped-inactive" }` (AC6).
 *
 * Detects `created` vs `noop` by comparing the returned row's
 * `createdAt` and `updatedAt` with a 2ms tolerance window — Prisma's
 * upsert does not expose a dedicated "was this newly inserted"
 * indicator, but a freshly created row's timestamps match within the
 * same insert transaction.
 */
export const upsertDefaultRule = async (
  prisma: PrismaClient,
  row: RuleSeedRow,
): Promise<UpsertDefaultRuleResult> => {
  assertValidSeedRow(row);

  let returned: Rule;
  try {
    returned = await prisma.rule.upsert({
      where: {
        deviceId_metric_operator_threshold_version: {
          // Prisma 5.x generates the unique compound input type with
          // `deviceId: string` even though the schema declares
          // `deviceId: String?`. Cast to satisfy tsc; the runtime
          // value is `null` per the spec (global rule → deviceId IS NULL).
          // TODO(review-prisma-6): revisit this cast when Prisma 6.x
          // is adopted — the unique-input type may finally accept
          // `string | null`. Do NOT remove the cast on a Prisma 5.x
          // codebase or the seed silently writes per-device rules
          // instead of global ones.
          deviceId: null as unknown as string,
          metric: row.metric,
          operator: row.operator,
          threshold: row.threshold,
          version: 1,
        },
      },
      create: {
        deviceId: null,
        metric: row.metric,
        operator: row.operator,
        threshold: row.threshold,
        severity: row.severity,
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
        version: 1,
        createdBy: null,
        isActive: true,
      },
      update: {},
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const wrapped = new Error(
        `seed: rule upsert race for key metric=${row.metric} operator=${row.operator} threshold=${row.threshold} severity=${row.severity} version=1 (P2002); retry the seed`,
      );
      // Preserve the original Prisma error in `cause` so debuggers
      // can still trace the source.
      (wrapped as Error & { cause?: unknown }).cause = err;
      throw wrapped;
    }
    throw err;
  }

  // Admin-took-over row: preserve as-is; never resurrect, never
  // overwrite (AC6). The drift check would otherwise flag the
  // `isActive: false` value vs the create payload's `isActive: true`,
  // so we short-circuit BEFORE the drift check. Strict equality (not
  // falsy) so a NULL `isActive` does not short-circuit and fall
  // through to drift.
  if (returned.isActive === false) {
    return { status: "skipped-inactive" };
  }

  // Drift check — the seven fields the seed owns must match. Any
  // divergence is a Story 3.7 admin edit (or other write) that
  // drifted the row; abort rather than silently overwrite (AC5).
  for (const field of DRIFT_CHECKED_FIELDS) {
    const desired = (() => {
      switch (field) {
        case "metric":
          return row.metric;
        case "operator":
          return row.operator;
        case "threshold":
          return row.threshold;
        case "severity":
          return row.severity;
        case "ruleType":
          return "instant";
        case "minDurationSeconds":
          return 0;
        case "hysteresisSeconds":
          return 0;
      }
    })();
    const existing = returned[field];
    if (existing !== desired) {
      throw new Error(
        `seed: existing Rule row at default key metric=${row.metric} operator=${row.operator} threshold=${row.threshold} severity=${row.severity} version=1 has different shape: existing=${JSON.stringify(pickDriftShape(returned))} desired=${JSON.stringify(desiredDriftShape(row))}; refusing to overwrite`,
      );
    }
  }

  // Distinguish `created` from `noop` by the timestamps with a 2ms
  // tolerance window. Prisma's upsert has no explicit "was this newly
  // inserted" return; for a freshly created row, `@default(now())`
  // and `@updatedAt` are both stamped inside the same insert
  // transaction. A subsequent update (even an empty `update: {}`)
  // would re-stamp `updatedAt` to a later millisecond.
  const tsDelta = Math.abs(
    returned.createdAt.getTime() - returned.updatedAt.getTime(),
  );
  const created = tsDelta < FRESH_TIMESTAMP_TOLERANCE_MS;
  return { status: created ? "created" : "noop" };
};
