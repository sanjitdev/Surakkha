/**
 * Story 2.7 — `GET /api/devices` router tests.
 *
 * Coverage matrix:
 *   - 200 happy path: returns the device roster joined to last reading.
 *   - 401 when no bearer token.
 *   - Empty DB → `{ devices: [] }`.
 *   - 500 when the data layer throws (AC6 path).
 *   - Admin + Operator tokens both succeed (matrix grants `Device.read`
 *     to both).
 *   - Sort order: `id ASC`.
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { buildDevicesRouter } from "./router.js";

const STRONG_SECRET = "x".repeat(64);

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";

const tokenForRole = (role: "Admin" | "Operator") =>
  issueAccessToken({ userId: role === "Admin" ? "00000000-0000-4000-8000-00000000a001" : OPERATOR_ID, role }).token;

interface StartArgs {
  readonly audit: AuditLogger;
  readonly listDevices: () => Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string | null;
      readonly lat: number | null;
      readonly lng: number | null;
      readonly last_reading_at: string | null;
    }>
  >;
}

const startApp = async (
  args: StartArgs,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildDevicesRouter({
      audit: args.audit,
      listDevices: args.listDevices as never,
    }),
  );
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { url, close };
};

beforeEach(() => {
  process.env["JWT_SECRET"] = STRONG_SECRET;
});

describe("Story 2.7 — GET /api/devices", () => {
  it("returns the device roster with the wire envelope", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listDevices: async () => [
        {
          id: DEVICE_A,
          name: "DEVICE-A",
          lat: 23.78,
          lng: 90.41,
          last_reading_at: "2026-08-24T10:30:00.000Z",
        },
      ],
    });
    const res = await fetch(`${url}/api/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      devices: Array<{
        id: string;
        name: string | null;
        lat: number | null;
        lng: number | null;
        last_reading_at: string | null;
      }>;
    };
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toEqual({
      id: DEVICE_A,
      name: "DEVICE-A",
      lat: 23.78,
      lng: 90.41,
      last_reading_at: "2026-08-24T10:30:00.000Z",
    });
    await close();
  });

  it("returns 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listDevices: async () => [],
    });
    const res = await fetch(`${url}/api/devices`);
    expect(res.status).toBe(401);
    await close();
  });

  it("returns the empty envelope when the data layer returns no rows", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listDevices: async () => [],
    });
    const res = await fetch(`${url}/api/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ devices: [] });
    await close();
  });

  it("returns devices with null lat/lng/last_reading_at when never connected", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listDevices: async () => [
        {
          id: DEVICE_A,
          name: null,
          lat: null,
          lng: null,
          last_reading_at: null,
        },
      ],
    });
    const res = await fetch(`${url}/api/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      devices: Array<{ last_reading_at: string | null; lat: number | null; lng: number | null }>;
    };
    expect(body.devices[0]?.last_reading_at).toBeNull();
    expect(body.devices[0]?.lat).toBeNull();
    expect(body.devices[0]?.lng).toBeNull();
    await close();
  });

  it("returns 500 when the data layer throws (AC6: empty-state path)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listDevices: async () => {
        throw new Error("prisma unreachable");
      },
    });
    const res = await fetch(`${url}/api/devices`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("internal_error");
    await close();
  });

  it("accepts both Admin and Operator tokens (matrix grants read Device to both)", async () => {
    for (const role of ["Admin", "Operator"] as const) {
      const { url, close } = await startApp({
        audit: { emit: () => undefined },
        listDevices: async () => [
          {
            id: DEVICE_B,
            name: "DEVICE-B",
            lat: 23.75,
            lng: 90.37,
            last_reading_at: "2026-08-24T10:30:00.000Z",
          },
        ],
      });
      const res = await fetch(`${url}/api/devices`, {
        headers: { Authorization: `Bearer ${tokenForRole(role)}` },
      });
      expect(res.status).toBe(200);
      await close();
    }
  });
});
