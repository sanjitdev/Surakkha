/**
 * Surakkha database seed — Story 2.5.
 *
 * Backfills the six default devices from
 * `packages/simulator/src/devices.json` into the `Device` table with
 * human-readable `name` + canonical `scenario`. Idempotent: uses
 * `upsert` keyed on `id` so re-running the seed never duplicates a
 * row.
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
 * `name` is a v1 placeholder derived from the device_id's last hex
 * digit; the Story 2.3 school/facility metadata (the canonical human
 * label) is a later story that fills `School.label`. v1 only needs
 * something stable for the admin tab to render.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Canonical six-device list mirrored from
 * `packages/simulator/src/devices.json`. The seed re-declares the
 * list rather than reading the simulator's file at runtime so the
 * seed has no cross-package dependency.
 */
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
 * Derive a stable v1 placeholder name from the UUID's last hex
 * digit. The Story 2.3 school-facility seed replaces this with the
 * canonical school label; for v1, "DEVICE-N" is enough to render the
 * admin tab row.
 */
const deriveName = (deviceId: string): string => {
  const tail = deviceId.slice(-1).toUpperCase();
  return `DEVICE-${tail}`;
};

const main = async (): Promise<void> => {
  const raw = readFileSync(DEVICES_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw) as DevicesFileShape;
  const prisma = new PrismaClient();
  try {
    for (const d of parsed.devices) {
      await prisma.device.upsert({
        where: { id: d.device_id },
        update: {
          name: deriveName(d.device_id),
          scenario: d.scenario,
        },
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
  console.error("seed: failed", err);
  // eslint-disable-next-line no-restricted-properties
  process.exit(1);
});
