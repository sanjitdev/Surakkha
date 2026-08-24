/**
 * Story 2.6 — `/api/readings/latest` router.
 *
 * Covers:
 *   - 200 happy path: returns the latest reading per device with the
 *     `LatestReadingsResponse` envelope.
 *   - 401 when no bearer token is presented.
 *   - 403 when a role denies `read Device` (none of the four v1 roles
 *     deny this — the matrix grants `read Device` to Admin/Operator/
 *     Technician/Viewer — so we only pin the 401 path).
 *   - 500 when the underlying data layer throws; the dashboard reads
 *     this via `isError` and renders the empty state per AC7.
 *   - Empty-DB case: `{ readings: [] }`.
 */
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { buildLatestReadingsRouter } from "./latestRouter.js";

const STRONG_SECRET = "x".repeat(64);

const DEVICE_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_B = "9b1c4f00-0000-4000-8000-000000000002";

const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";

const tokenForRole = (role: "Admin" | "Operator") =>
  issueAccessToken({ userId: role === "Admin" ? "00000000-0000-4000-8000-00000000a001" : OPERATOR_ID, role }).token;

interface StartArgs {
  readonly audit: AuditLogger;
  readonly listLatest: () => Promise<
    ReadonlyArray<{
      readonly device_id: string;
      readonly name: string | null;
      readonly ts: number;
      readonly server_received_at: string;
      readonly metrics: Record<string, number>;
      readonly flags: readonly string[];
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
    buildLatestReadingsRouter({
      audit: args.audit,
      listLatest: args.listLatest as never,
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

describe("Story 2.6 — GET /api/readings/latest", () => {
  it("returns the latest reading per device with the wire envelope", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listLatest: async () => [
        {
          device_id: DEVICE_A,
          name: "DEVICE-A",
          ts: 1_700_000_000,
          server_received_at: "2026-08-20T10:31:04.000Z",
          metrics: {
            ph: 7.2,
            tds_ppm: 180,
            turbidity_ntu: 0.4,
            temp_c: 27.4,
            chlorine_ppm: 0.6,
            water_level_cm: 85,
          },
          flags: [],
        },
      ],
    });
    const res = await fetch(`${url}/api/readings/latest`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      readings: Array<{ device_id: string; name: string | null }>;
    };
    expect(body.readings).toHaveLength(1);
    expect(body.readings[0]?.device_id).toBe(DEVICE_A);
    expect(body.readings[0]?.name).toBe("DEVICE-A");
    await close();
  });

  it("returns 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listLatest: async () => [],
    });
    const res = await fetch(`${url}/api/readings/latest`);
    expect(res.status).toBe(401);
    await close();
  });

  it("returns the empty envelope when the DB has zero readings", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listLatest: async () => [],
    });
    const res = await fetch(`${url}/api/readings/latest`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ readings: [] });
    await close();
  });

  it("returns 500 when the data layer throws (AC7: empty-state path)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      listLatest: async () => {
        throw new Error("prisma unreachable");
      },
    });
    const res = await fetch(`${url}/api/readings/latest`, {
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
        listLatest: async () => [
          {
            device_id: DEVICE_B,
            name: "DEVICE-B",
            ts: 1_700_000_000,
            server_received_at: "2026-08-20T10:31:04.000Z",
            metrics: {
              ph: 7,
              tds_ppm: 100,
              turbidity_ntu: 0.5,
              temp_c: 27,
              chlorine_ppm: 0.5,
              water_level_cm: 80,
            },
            flags: [],
          },
        ],
      });
      const res = await fetch(`${url}/api/readings/latest`, {
        headers: { Authorization: `Bearer ${tokenForRole(role)}` },
      });
      expect(res.status).toBe(200);
      await close();
    }
  });
});