/**
 * Surakkha database seed — Story 2.5.
 *
 * Backfills the six default devices from
 * `packages/simulator/src/devices.json` into the `Device` table with
 * human-readable `name` + canonical `scenario`. Idempotent: re-runs
 * never duplicate a row, and the `update` branch is null-guarded so
 * a Story 2.3-canonical `name` (or a runtime-switched `scenario`)
 * is never silently overwritten.
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
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { assertValidScenario, deriveName } from "./seedHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEVICES_JSON_PATH = resolve(
  __dirname,
  "..",
  "..",
  "simulator",
  "src",
  "devices.json",
);

interface DevicesFileShape {
  readonly tick_interval_ms: number;
  readonly devices: ReadonlyArray<{
    readonly device_id: string;
    readonly scenario: string;
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
    throw new Error(
      `seed: failed to read ${DEVICES_JSON_PATH}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `seed: malformed JSON in devices.json: ${(err as Error).message}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { devices?: unknown }).devices)
  ) {
    throw new Error(
      "seed: devices.json must be an object with a `devices` array",
    );
  }
  return parsed as DevicesFileShape;
};

const main = async (): Promise<void> => {
  const parsed = loadDevicesFile();
  if (parsed.devices.length === 0) {
    console.warn(
      "seed: devices.json contains zero devices — nothing to backfill",
    );
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
        select: { name: true, scenario: true },
      });

      const updateFields: { name?: string; scenario?: string } = {};
      if (existing?.name === null) {
        updateFields.name = deriveName(d.device_id);
      }
      if (existing?.scenario === null) {
        updateFields.scenario = d.scenario;
      }

      await prisma.device.upsert({
        where: { id: d.device_id },
        update: updateFields,
        create: {
          id: d.device_id,
          name: deriveName(d.device_id),
          scenario: d.scenario,
        },
      });
    }
    // eslint-disable-next-line no-console
    console.log(
      `seed: upserted ${parsed.devices.length} device rows (name + scenario backfill)`,
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
