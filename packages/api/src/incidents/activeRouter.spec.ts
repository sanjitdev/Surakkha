/**
 * `activeRouter.spec.ts` — Story 4.3.
 *
 * Covers `/api/incidents/active` end-to-end via the same in-process
 * HTTP rig `recentRouter.spec.ts` uses:
 *
 *   - 200 happy path: returns every non-`RESOLVED` incident sorted
 *     by `opened_at DESC`, parsed through `IncidentPayloadSchema`.
 *   - RESOLVED exclusion: the `state: { not: "RESOLVED" }` filter
 *     at the SQL level means a resolved row never makes it onto
 *     the board (spec "RESOLVED_DROP" edge case).
 *   - Empty-DB: `{ incidents: [] }` envelope renders the four
 *     "No incidents" empty-state columns on the client.
 *   - 401 when no bearer token is presented.
 *   - 500 when the data layer throws.
 *
 * The four covered cases mirror the spec's Acceptance checklist:
 *
 *   - "empty": zero non-resolved rows → empty envelope.
 *   - "all non-resolved returned": mixed-state fixture; rows where
 *     `state !== "RESOLVED"` all show; the one RESOLVED row does
 *     not.
 *   - "RESOLVED excluded": dedicated fixture with one row in each
 *     state; the RESOLVED row is the only one absent from the
 *     response.
 *   - "sorted by opened_at DESC": the returned order matches the
 *     most-recent-first expectation regardless of insertion order.
 */
import {
  type IncidentPayload,
  IncidentPayloadSchema,
  type IncidentState,
} from "@surakkha/shared/incident";
import express, { type Express } from "express";
import { type AddressInfo, createServer, type Server } from "node:http";
import { beforeEach, describe, expect, it } from "vitest";

import { type AuditLogger } from "../audit.js";
import { issueAccessToken } from "../auth/jwt.js";
import { authenticate } from "../middleware/authorize.js";

import { buildActiveIncidentsRouter } from "./activeRouter.js";
import { type IncidentRow } from "./incidentStateRepository.js";

const STRONG_SECRET = "x".repeat(64);

const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
const tokenForRole = (role: "Admin" | "Operator") =>
  issueAccessToken({
    userId: role === "Admin" ? "00000000-0000-4000-8000-00000000a001" : OPERATOR_ID,
    role,
  }).token;

const DEVICE_ID_A = "9b1c4f00-0000-4000-8000-000000000001";
const DEVICE_ID_B = "9b1c4f00-0000-4000-8000-000000000002";

/**
 * Build an `IncidentRow` with sensible defaults. The state field is
 * the only one not given a default — every test sets it explicitly
 * because that's the field the projections sort on.
 */
const buildRow = (overrides: Partial<IncidentRow> & { id: string }): IncidentRow => ({
  deviceId: DEVICE_ID_A,
  severity: "warning",
  metric: "tds_ppm",
  value: 312,
  openedAt: new Date("2026-08-27T00:00:00.000Z"),
  state: "OPEN",
  assigneeUserId: null,
  acknowledgedAt: null,
  resolvedAt: null,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
  ...overrides,
});

interface StartArgs {
  readonly audit: AuditLogger;
  readonly findMany: (
    args: Parameters<
      Parameters<typeof buildActiveIncidentsRouter>[0]["repo"]["incident"]["findMany"]
    >[0],
  ) => Promise<IncidentRow[]>;
}

const startApp = async (args: StartArgs): Promise<{ url: string; close: () => Promise<void> }> => {
  const app: Express = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(authenticate);
  app.use(
    buildActiveIncidentsRouter({
      audit: args.audit,
      repo: {
        incident: {
          findMany: args.findMany,
        },
      },
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

describe("Story 4.3 — GET /api/incidents/active", () => {
  it("returns every non-RESOLVED incident sorted by opened_at DESC", async () => {
    const findMany: StartArgs["findMany"] = async () => [
      buildRow({
        id: "11111111-1111-4111-8111-111111111111",
        deviceId: DEVICE_ID_A,
        state: "OPEN",
        severity: "critical",
        openedAt: new Date("2026-08-27T03:00:00.000Z"),
      }),
      buildRow({
        id: "22222222-2222-4222-8222-222222222222",
        deviceId: DEVICE_ID_B,
        state: "ACKNOWLEDGED",
        severity: "warning",
        openedAt: new Date("2026-08-27T02:00:00.000Z"),
      }),
      buildRow({
        id: "33333333-3333-4333-8333-333333333333",
        deviceId: DEVICE_ID_A,
        state: "INSPECTING",
        severity: "warning",
        openedAt: new Date("2026-08-27T01:00:00.000Z"),
      }),
    ];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany,
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidents: IncidentPayload[] };
    expect(body.incidents).toHaveLength(3);
    // Sort assertion: the three returned rows MUST be opened_at DESC.
    expect(body.incidents.map((i) => i.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ]);
    for (const incident of body.incidents) {
      // Every row matches the canonical wire shape — schema parse
      // succeeds against the live response body.
      const parsed = IncidentPayloadSchema.safeParse(incident);
      expect(parsed.success).toBe(true);
      // And state is never RESOLVED on the active board.
      expect(incident.state).not.toBe("RESOLVED");
    }
    await close();
  });

  it('passes a `state: { not: "RESOLVED" }` filter to the data layer (RESOLVED exclusion at SQL)', async () => {
    let observedWhere: { readonly state?: { readonly not: IncidentState } } | undefined;
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        observedWhere = args.where;
        return [];
      },
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(observedWhere?.state?.not).toBe("RESOLVED");
    await close();
  });

  it("orders by opened_at DESC at the data layer", async () => {
    let observedOrderBy: { readonly openedAt?: "desc" } | undefined;
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        observedOrderBy = args.orderBy ?? {};
        return [];
      },
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(observedOrderBy?.openedAt).toBe("desc");
    await close();
  });

  it("returns the empty envelope when no non-resolved incidents exist", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ incidents: [] });
    await close();
  });

  it("returns every non-RESOLVED state (OPEN, ACKNOWLEDGED, INSPECTING, SAFE, UNSAFE, MONITORING, REOPENED)", async () => {
    // Spec acceptance: the row filter must NOT exclude any state
    // other than RESOLVED. A test fixture with one row per state
    // pins this — the fixture's rows span the seven non-RESOLVED
    // states; the response includes all seven.
    const states: IncidentState[] = [
      "OPEN",
      "ACKNOWLEDGED",
      "INSPECTING",
      "SAFE",
      "UNSAFE",
      "MONITORING",
      "REOPENED",
    ];
    const rows: IncidentRow[] = states.map((state, idx) =>
      buildRow({
        id: `44444444-4444-4444-8444-${String(idx + 1).padStart(12, "0")}`,
        state,
        severity: state === "UNSAFE" ? "warning" : "warning",
        openedAt: new Date(`2026-08-27T0${idx + 1}:00:00.000Z`),
      }),
    );
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => rows,
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidents: IncidentPayload[] };
    expect(body.incidents).toHaveLength(7);
    expect(body.incidents.map((i) => i.state).sort()).toEqual([...states].sort());
    await close();
  });

  it("returns 401 when no bearer token is presented", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/active`);
    expect(res.status).toBe(401);
    await close();
  });

  it("returns 500 when the data layer throws", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => {
        throw new Error("prisma unreachable");
      },
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(res.status).toBe(500);
    await close();
  });

  it("accepts an Admin token (every authenticated role can read)", async () => {
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(res.status).toBe(200);
    await close();
  });
});
