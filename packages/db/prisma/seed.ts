/**
 * Surakkha database seed — Story 2.5 + Story 3.3.
 *
 * Story 2.5: Backfills the six default devices from
 * `packages/simulator/src/devices.json` into the `Device` table with
 * human-readable `name` + canonical `scenario`. Idempotent: re-runs
 * never duplicate a row, and the `update` branch is null-guarded so
 * a Story 2.3-canonical `name` (or a runtime-switched `scenario`)
 * is never silently overwritten.
 *
 * Story 3.3: Upserts the nine FR-13 default threshold `Rule` rows
 * (BRD §8.3.1) into the `Rule` table. Idempotent via the natural
 * `@@unique([deviceId, metric, operator, threshold, version])` key
 * with `update: {}` — a re-run never duplicates a row. Admin-edited
 * rows (Story 3.7) that flip `isActive: false` are preserved as-is
 * (returned `{ status: "skipped-inactive" }`); drifted shapes throw
 * rather than silently overwriting.
 *
 * Run via:
 *   pnpm --filter @surakkha/db seed
 *
 * The canonical UUIDv4 device IDs are the wire-contract identity
 * (architecture §3.1) — both the simulator's `devices.json` and this
 * seed reference the same six IDs so the api's
 * `GET /admin/simulator/devices` listing matches the simulator's
 * in-memory client registry.
 *
 * `name` is a v1 placeholder derived from the device_id's last 4 hex
 * digits; the Story 2.3 school/facility metadata (the canonical human
 * label) is a later story that fills `School.label`. v1 only needs
 * something stable for the admin tab to render. We use last-4-hex
 * rather than last-1-hex so two UUIDs that share a trailing hex digit
 * don't collide in the admin tab's row label.
 *
 * The seed reads `packages/simulator/src/devices.json` at runtime
 * (filesystem coupling). This is intentional — the simulator's
 * devices.json is the source of truth for the wire contract, and the
 * seed mirrors it. The simulator does NOT import `@surakkha/db`
 * (Forbidden by spec: simulator is a separate process); the coupling
 * flows the other way only.
 *
 * The threshold rows are sourced from `./thresholdTable.js` (a pure
 * module, FR-13 verbatim, typed against `@surakkha/shared`'s enum
 * arrays). Story 3.7's admin-tab "reset to defaults" button could
 * re-import the same constant.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  assertValidScenario,
  buildDeviceUpdateFields,
  deriveName,
  upsertDefaultRule,
} from "./seedHelpers.js";
import { THRESHOLD_TABLE } from "./thresholdTable.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEVICES_JSON_PATH = resolve(__dirname, "..", "..", "simulator", "src", "devices.json");

interface DevicesFileShape {
  readonly tick_interval_ms: number;
  readonly devices: ReadonlyArray<{
    readonly device_id: string;
    readonly scenario: string;
    readonly lat?: number;
    readonly lng?: number;
  }>;
}

/**
 * Read + parse + validate `devices.json`. Throws with a descriptive
 * error on any failure so the seed exits with a clear message rather
 * than a raw ENOENT / SyntaxError.
 */
const loadDevicesFile = (): DevicesFileShape => {
  let raw: string;
  try {
    raw = readFileSync(DEVICES_JSON_PATH, "utf8");
  } catch (err) {
    throw new Error(`seed: failed to read ${DEVICES_JSON_PATH}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`seed: malformed JSON in devices.json: ${(err as Error).message}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { devices?: unknown }).devices)
  ) {
    throw new Error("seed: devices.json must be an object with a `devices` array");
  }
  return parsed as DevicesFileShape;
};

const main = async (): Promise<void> => {
  const parsed = loadDevicesFile();
  if (parsed.devices.length === 0) {
    console.warn("seed: devices.json contains zero devices — nothing to backfill");
    return;
  }

  const prisma = new PrismaClient();
  try {
    for (const d of parsed.devices) {
      // Validate before touching the DB so a bad scenario rejects fast.
      assertValidScenario(d.scenario);

      // Idempotent backfill: read first so the `update` branch only
      // fills null fields. A Story 2.3-canonical `name` (or a
      // runtime-switched `scenario` persisted by Story 2.5's admin
      // tab) is never silently overwritten on re-run.
      const existing = await prisma.device.findUnique({
        where: { id: d.device_id },
        select: { name: true, scenario: true, lat: true, lng: true },
      });

      const updateFields = buildDeviceUpdateFields(existing, d, deriveName);

      await prisma.device.upsert({
        where: { id: d.device_id },
        update: updateFields,
        create: {
          id: d.device_id,
          name: deriveName(d.device_id),
          scenario: d.scenario,
          lat: d.lat,
          lng: d.lng,
        },
      });
    }

    // Story 3.3: FR-13 default thresholds. Idempotent (uses the
    // natural `@@unique` key + `update: {}` no-op); admin-edited rows
    // are preserved via `skipped-inactive` rather than resurrected.
    // Placed BEFORE the device-loop success log so a seed abort
    // (drift error, P2002 race) shows up in CI logs after the device
    // upserts but before any "all good" device-loop success line.
    let createdCount = 0;
    let noopCount = 0;
    let skippedCount = 0;
    if (THRESHOLD_TABLE.length === 0) {
      // eslint-disable-next-line no-console
      console.log("seed: THRESHOLD_TABLE is empty — no-op");
    } else {
      for (const row of THRESHOLD_TABLE) {
        const result = await upsertDefaultRule(prisma, row);
        if (result.status === "created") {
          createdCount += 1;
        } else if (result.status === "noop") {
          noopCount += 1;
        } else if (result.status === "skipped-inactive") {
          skippedCount += 1;
          // eslint-disable-next-line no-console
          console.log(
            `seed: rule metric=${row.metric} operator=${row.operator} threshold=${row.threshold} was deactivated by an admin; preserving as-is`,
          );
        }
        // "noop" — row already existed with matching shape; nothing
        // to log (the `update: {}` no-op is the load-bearing detail).
      }
      // eslint-disable-next-line no-console
      console.log(
        `seed: processed ${THRESHOLD_TABLE.length} default rule rows (BRD §8.3.1, global / version 1): ${createdCount} created, ${noopCount} no-op, ${skippedCount} preserved as inactive`,
      );
    }

    // Device-loop success log — fires AFTER the rule work so a rule
    // drift / P2002 race abort shows up in CI logs before any "all
    // good" device success line. Per F1/F4 re-review.
    // eslint-disable-next-line no-console
    console.log(
      `seed: upserted ${parsed.devices.length} device rows (name + scenario + lat/lng backfill)`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  // eslint-disable-next-line no-restricted-properties
  process.exit(1);
});
