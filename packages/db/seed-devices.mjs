/* eslint-env node */
// Quick dev seed — creates the 6 demo devices so the simulator
// can ingest telemetry without FK violations. This bypasses the
// broken `pnpm seed` (which expects Rule.deviceId nullable but
// the schema requires it).
import { PrismaClient } from "@prisma/client";

const c = new PrismaClient();

const devices = [
  {
    id: "9b1c4f00-0000-4000-8000-000000000001",
    name: "SURAKKHA-A01",
    scenario: "Normal",
    lat: 23.7806,
    lng: 90.4074,
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000002",
    name: "SURAKKHA-B02",
    scenario: "RisingTDS",
    lat: 23.7461,
    lng: 90.3742,
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000003",
    name: "SURAKKHA-C03",
    scenario: "TurbiditySpike",
    lat: 23.8103,
    lng: 90.4125,
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000004",
    name: "SURAKKHA-D04",
    scenario: "ChlorineDrop",
    lat: 23.728,
    lng: 90.3965,
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000005",
    name: "SURAKKHA-E05",
    scenario: "Offline",
    lat: 23.792,
    lng: 90.425,
  },
  {
    id: "9b1c4f00-0000-4000-8000-000000000006",
    name: "SURAKKHA-F06",
    scenario: "RandomFailure",
    lat: 23.759,
    lng: 90.448,
  },
];

await Promise.all(
  devices.map((d) =>
    c.device.upsert({
      where: { id: d.id },
      update: {},
      create: d,
    }),
  ),
);
globalThis.console.log("seeded", devices.length, "devices");
await c.$disconnect();
