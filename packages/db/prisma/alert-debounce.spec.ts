/**
 * Live integration test for the `Alert` partial unique index
 * (Story 3.4, AC11) and the `Device → RuleDebounceState` cascade
 * (Story 3.4, AC10).
 *
 * Required by spec line 88. This file is the load-bearing end-to-end
 * pin for the partial unique index `Alert_open_unique_idx WHERE
 * "clearedAt" IS NULL` — the safety net for the open race the
 * api's `$transaction` + `isPrismaP2002` catch (Story 3.4 P3 + P10)
 * rely on. The companion source-walk pins live in:
 *   - `packages/db/__tests__/alert-debounce.schema.spec.ts`
 *   - `packages/db/__tests__/alert-debounce.migration.spec.ts`
 *
 * What this file pins (live Prisma against the configured Postgres):
 *
 *   1. `Alert_open_unique_idx` exists on `Alert(deviceId, metric,
 *      severity) WHERE "clearedAt" IS NULL` (raw `pg_indexes` check;
 *      if a future change drops the partial predicate, AC11 silently
 *      regresses and only the live test catches it).
 *
 *   2. Sequential `prisma.alert.create` × 2 with the same
 *      `(deviceId, metric, severity)`:
 *      - first insert succeeds and returns the row;
 *      - second insert rejects with `Prisma.PrismaClientKnownRequestError`
 *        whose `code === "P2002"`.
 *
 *   3. Sequential `prisma.alert.create` × 2 with DIFFERENT
 *      `clearedAt` states (first OPEN, then CLEARED) both succeed —
 *      the partial predicate is the load-bearing detail (a future
 *      change to a plain `@@unique` would reject the second insert
 *      and this test would fail).
 *
 *   4. Concurrent `prisma.alert.create` × 2 (one per Prisma client)
 *      for the same `(deviceId, metric, severity)` yields exactly
 *      ONE persisted row + ONE `P2002`. This is the actual AC11
 *      scenario: two api processes racing on a brand-new device.
 *
 *   5. `prisma.device.delete({ where: { id: deviceId } })` cascades
 *      to the `RuleDebounceState` rows owned by that device:
 *      `prisma.ruleDebounceState.findFirst` returns null after the
 *      delete. AC10 contract — a removed Device does not leave ghost
 *      timers on re-add.
 *
 * Test isolation strategy:
 *   - Each test uses a freshly-generated `deviceId` (UUIDv4 from
 *     `crypto.randomUUID`) so concurrent test runs across CI lanes
 *     never collide.
 *   - A shared `Rule` row is created in `beforeAll` (the
 *     `prisma.alert.create` cascade also drops alerts when the rule
 *     is removed — the rule's `id` is the FK target for `Alert.ruleId`).
 *   - Each test deletes only its OWN device row in `afterEach`, so a
 *     failure in one test does not poison the next.
 *   - If the migration has not been applied, the test reads
 *     `prisma.\$queryRaw` for the index and asserts the index
 *     presence FIRST; that fails fast with a clear message if the
 *     operator forgot to run `prisma migrate deploy`.
 *
 * Prerequisites (local dev):
 *   - Postgres reachable at `DATABASE_URL` (defaults to local dev
 *     `localhost:5432/surakkha`).
 *   - Migrations applied: `pnpm --filter @surakkha/db exec prisma
 *     migrate deploy`.
 *
 * Prerequisites (CI):
 *   - Story 3.4 owns this test. CI wiring is deferred to the spec's
 *     follow-up (the `e2e` job in `.github/workflows/ci.yml` is a
 *     placeholder as of Story 3.4 ship).
 */
import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import type { RuleMetric, RuleSeverity } from "@surakkha/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * `Alert.deviceId` + `Alert.metric` + `Alert.severity` is the partial
 * unique index key. Constants so the assertion message stays
 * greppable. Types are sourced from `@surakkha/shared` (the
 * shared wire-contract enum source — mirrors the Prisma-side
 * `RuleMetric` / `RuleSeverity` enums 1:1).
 */
const ALERT_METRIC: RuleMetric = "ph";
const ALERT_SEVERITY: RuleSeverity = "critical";

const prisma = new PrismaClient();

/**
 * Verify the migration that creates `Alert_open_unique_idx` is
 * applied. The test pins the partial predicate (`WHERE "clearedAt"
 * IS NULL`) — without it, AC11 silently regresses to "at most one
 * Alert row per (device, metric, severity) EVER", which would
 * silently break `cleared` alert history.
 */
const assertPartialIndexPresent = async (): Promise<void> => {
  const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'Alert_open_unique_idx'
  `;
  expect(rows.length).toBe(1);
  expect(rows[0]?.indexdef).toContain("WHERE");
  expect(rows[0]?.indexdef.toUpperCase()).toContain('"CLEAREDAT" IS NULL');
};

describe("Story 3.4 — Alert partial unique index + cascade (AC10, AC11)", () => {
  // Shared Rule row — `Alert.ruleId` is a NOT NULL FK to `Rule.id`.
  // One row per test file is enough; each test inserts its own
  // Device + Alert.
  let sharedRuleId: string;

  beforeAll(async () => {
    await assertPartialIndexPresent();
    const rule = await prisma.rule.create({
      data: {
        deviceId: null,
        metric: ALERT_METRIC,
        operator: "lt",
        threshold: 6.5,
        severity: ALERT_SEVERITY,
        ruleType: "instant",
        minDurationSeconds: 0,
        hysteresisSeconds: 0,
        version: 1,
        createdBy: "alert-debounce.spec.ts",
        isActive: true,
      },
      select: { id: true },
    });
    sharedRuleId = rule.id;
  });

  afterAll(async () => {
    // Best-effort: drop the shared rule. `Alert.ruleId` cascades on
    // delete, but the per-test devices were dropped in `afterEach`;
    // any leftover rows are surfaced as a test failure, not a
    // teardown error.
    try {
      await prisma.rule.delete({ where: { id: sharedRuleId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  // Each test owns its Device and its Alert rows. `afterEach` drops
  // the device; the FK CASCADE collapses the alerts.
  const createdDeviceIds: string[] = [];

  afterEach(async () => {
    while (createdDeviceIds.length > 0) {
      const id = createdDeviceIds.pop();
      if (id === undefined) break;
      try {
        await prisma.device.delete({ where: { id } });
      } catch {
        // Ignore — already deleted by an earlier `expect.rejects`
        // path or by a previous `afterEach`.
      }
    }
  });

  /**
   * Helper: create a fresh Device + return its id. The Alert's
   * `deviceId` FK must point at an existing Device row.
   */
  const mkDevice = async (): Promise<string> => {
    const id = randomUUID();
    await prisma.device.create({
      data: { id },
      select: { id: true },
    });
    createdDeviceIds.push(id);
    return id;
  };

  /**
   * Helper: open an Alert for the given device. Mirrors the
   * `applyOpenTransition` shape: `openedAt` defaults to "now" via
   * the Prisma schema default, but the test pins an explicit value
   * so the assertion is deterministic.
   */
  const openAlert = (deviceId: string, openedAt: Date): Promise<{ readonly id: string }> =>
    prisma.alert.create({
      data: {
        deviceId,
        ruleId: sharedRuleId,
        severity: ALERT_SEVERITY,
        metric: ALERT_METRIC,
        openedAt,
      },
      select: { id: true },
    });

  it("AC11 (1/3) — first prisma.alert.create for a fresh (deviceId, metric, severity) succeeds", async () => {
    const deviceId = await mkDevice();
    const openedAt = new Date("2026-08-26T00:00:00.000Z");
    const created = await openAlert(deviceId, openedAt);
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("AC11 (2/3) — second prisma.alert.create with the SAME (deviceId, metric, severity) while the first is still open rejects with Prisma P2002", async () => {
    const deviceId = await mkDevice();
    const openedAt = new Date("2026-08-26T00:00:01.000Z");

    // First insert succeeds.
    await openAlert(deviceId, openedAt);

    // Second insert: same (deviceId, metric, severity), same openedAt.
    // The partial unique index bars a second OPEN row for the key.
    let captured: unknown = null;
    try {
      await openAlert(deviceId, openedAt);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    const known = captured as Prisma.PrismaClientKnownRequestError;
    expect(known.code).toBe("P2002");
    // `meta.target` reports the column tuple that hit the unique
    // constraint (`["deviceId","metric","severity"]`). The index
    // NAME itself does not surface in `meta`, so the test verifies
    // the partial predicate via `pg_constraint` AFTER the catch —
    // a regression that drops the WHERE clause is still pinned.
    expect(JSON.stringify(known.meta)).toContain("deviceId");
    expect(JSON.stringify(known.meta)).toContain("metric");
    expect(JSON.stringify(known.meta)).toContain("severity");

    // Cross-check: the partial unique index is still the source of
    // the violation. Query `pg_index` to confirm the predicate
    // matches `Alert_open_unique_idx WHERE "clearedAt" IS NULL`.
    // Postgres implements a partial UNIQUE INDEX (not a UNIQUE
    // CONSTRAINT), so the `pg_index` catalogue is the right view
    // — `pg_constraint` only sees CONSTRAINTs, not raw indexes.
    // `regclass::text` casts work around Prisma's
    // unsupported-regclass-type deserialiser.
    const indexes = await prisma.$queryRaw<Array<{ idxname: string; def: string }>>`
      SELECT indexrelid::regclass::text AS idxname,
             pg_get_indexdef(indexrelid) AS def
      FROM pg_index
      WHERE indrelid = '"Alert"'::regclass
        AND indisunique = true
    `;
    const partial = indexes.find((row) => {
      const upper = row.def.toUpperCase();
      return (
        row.idxname.includes("Alert_open_unique_idx") &&
        row.def.includes("deviceId") &&
        row.def.includes("metric") &&
        row.def.includes("severity") &&
        upper.includes("CLEAREDAT") &&
        upper.includes("IS NULL")
      );
    });
    expect(partial).toBeDefined();

    // Exactly ONE row persists (the partial index did its job).
    const remaining = await prisma.alert.findMany({
      where: { deviceId },
      select: { id: true },
    });
    expect(remaining.length).toBe(1);
  });

  it("AC11 (3/3) — clearing the first Alert (set clearedAt) UNBLOCKS a second OPEN row for the same (deviceId, metric, severity); partial predicate is the load-bearing detail", async () => {
    // A naive `@@unique` would reject the second insert even after
    // the first is cleared. The partial predicate `WHERE
    // "clearedAt" IS NULL` is what makes `cleared` history co-exist
    // with a NEW open row for the same key. If a future change
    // drops the WHERE clause, this test fails.
    const deviceId = await mkDevice();
    const openedAt = new Date("2026-08-26T00:00:02.000Z");

    const first = await openAlert(deviceId, openedAt);
    // Close the first row.
    await prisma.alert.update({
      where: { id: first.id },
      data: { clearedAt: new Date("2026-08-26T00:00:03.000Z") },
    });

    // Second OPEN row for the same key — must succeed because
    // `clearedAt IS NOT NULL` for the first row.
    const second = await openAlert(deviceId, new Date("2026-08-26T00:00:04.000Z"));
    expect(second.id).not.toBe(first.id);

    // Both rows persist.
    const all = await prisma.alert.findMany({
      where: { deviceId },
      select: { id: true, clearedAt: true },
    });
    expect(all.length).toBe(2);
    expect(all.find((r) => r.id === first.id)?.clearedAt).not.toBeNull();
    expect(all.find((r) => r.id === second.id)?.clearedAt).toBeNull();
  });

  it("AC11 (race) — two Prisma clients inserting concurrently for the same key: exactly ONE row persists + ONE P2002", async () => {
    // The actual AC11 scenario: two api processes racing on a
    // brand-new device. Each Prisma client opens its own Postgres
    // session; both `INSERT` statements land inside the same
    // transaction window. The partial unique index is the
    // serialization point — exactly one wins, the other gets
    // P2002.
    const deviceId = await mkDevice();

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    const openedAt = new Date("2026-08-26T00:00:05.000Z");

    let raceWinner: "A" | "B" | "draw" = "draw";
    let p2002From: "A" | "B" | null = null;

    const insertA = clientA.alert
      .create({
        data: {
          deviceId,
          ruleId: sharedRuleId,
          severity: ALERT_SEVERITY,
          metric: ALERT_METRIC,
          openedAt,
        },
        select: { id: true },
      })
      .then((row) => {
        raceWinner = "A";
        return row;
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          p2002From = "A";
          return null;
        }
        throw err;
      });

    const insertB = clientB.alert
      .create({
        data: {
          deviceId,
          ruleId: sharedRuleId,
          severity: ALERT_SEVERITY,
          metric: ALERT_METRIC,
          openedAt,
        },
        select: { id: true },
      })
      .then((row) => {
        raceWinner = "B";
        return row;
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          p2002From = "B";
          return null;
        }
        throw err;
      });

    const [a, b] = await Promise.all([insertA, insertB]);
    await clientA.$disconnect();
    await clientB.$disconnect();

    // Exactly one row landed.
    expect([a, b].filter((r) => r !== null).length).toBe(1);
    // The other side caught P2002.
    expect(p2002From).not.toBeNull();
    expect(p2002From).not.toBe(raceWinner);

    // DB state: exactly one Alert row for this device.
    const persisted = await prisma.alert.findMany({
      where: { deviceId },
      select: { id: true },
    });
    expect(persisted.length).toBe(1);
  });

  it("AC10 — prisma.device.delete CASCADES to RuleDebounceState rows owned by the device (no ghost timers)", async () => {
    // AC10 contract: a removed Device does not leave a
    // `RuleDebounceState` row behind. The api's de-bounce timer
    // re-derives on the next frame, but only if the on-disk row
    // was actually dropped.
    const deviceId = await mkDevice();

    await prisma.ruleDebounceState.create({
      data: {
        deviceId,
        metric: ALERT_METRIC,
        severity: ALERT_SEVERITY,
        inViolationSince: new Date("2026-08-26T00:00:06.000Z"),
        clearedSince: null,
      },
      select: { id: true },
    });

    // Sanity: the row is visible BEFORE delete.
    const beforeDelete = await prisma.ruleDebounceState.findFirst({
      where: { deviceId, metric: ALERT_METRIC, severity: ALERT_SEVERITY },
      select: { id: true },
    });
    expect(beforeDelete).not.toBeNull();

    // Remove the device. The `RuleDebounceState.deviceId` FK
    // declares `onDelete: Cascade`; the matching Postgres-level FK
    // constraint is what enforces it.
    // Pop from `createdDeviceIds` first so `afterEach` does not
    // try to re-delete and trip a "record not found" error after
    // the cascade has already fired.
    const idx = createdDeviceIds.indexOf(deviceId);
    if (idx !== -1) createdDeviceIds.splice(idx, 1);
    await prisma.device.delete({ where: { id: deviceId } });

    // The state row is GONE — not orphaned, not dangling.
    const afterDelete = await prisma.ruleDebounceState.findFirst({
      where: { deviceId, metric: ALERT_METRIC, severity: ALERT_SEVERITY },
      select: { id: true },
    });
    expect(afterDelete).toBeNull();
  });

  it("AC10 (sanity) — prisma.device.delete ALSO CASCADES to Alert rows owned by the device", async () => {
    // Companion pin: same CASCADE contract applies to Alert rows.
    // Belt-and-braces — the spec calls out RuleDebounceState by name
    // (Finding #5) but the Alert cascade is the same FK declaration
    // and a future drift on one side without the other would be a
    // regression worth pinning here.
    const deviceId = await mkDevice();
    const openedAt = new Date("2026-08-26T00:00:07.000Z");
    const alert = await openAlert(deviceId, openedAt);

    const beforeDelete = await prisma.alert.findFirst({
      where: { id: alert.id },
      select: { id: true },
    });
    expect(beforeDelete).not.toBeNull();

    const idx = createdDeviceIds.indexOf(deviceId);
    if (idx !== -1) createdDeviceIds.splice(idx, 1);
    await prisma.device.delete({ where: { id: deviceId } });

    const afterDelete = await prisma.alert.findFirst({
      where: { id: alert.id },
      select: { id: true },
    });
    expect(afterDelete).toBeNull();
  });
});
