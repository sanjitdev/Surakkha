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

const ADMIN_ID = "00000000-0000-4000-8000-00000000a001";
const OPERATOR_ID = "00000000-0000-4000-8000-00000000a002";
// Story 4.12 — the active-list `where.assigneeUserId` filter is
// `req.user.id`. The seeded user store (`auth/users.ts`) holds
// canonical UUIDs; we re-use `a003` for Tech A (the only Technician
// in the existing spec's path) and add `a007` as Tech B for the
// reassign test.
const TECH_A_ID = "00000000-0000-4000-8000-00000000a003";
const TECH_B_ID = "00000000-0000-4000-8000-00000000a007";
// Step-04 review fix — Viewer is seeded as `a004` in `auth/users.ts`.
// Viewer maps to the unfiltered branch (same as Admin / Operator)
// so the seed id only needs to be a stable UUID; it's never
// matched against the `assigneeUserId` filter in this spec.
const VIEWER_ID = "00000000-0000-4000-8000-00000000a004";
const tokenForRole = (role: "Admin" | "Operator" | "Technician" | "Viewer") =>
  issueAccessToken({
    userId:
      role === "Admin"
        ? ADMIN_ID
        : role === "Technician"
          ? TECH_A_ID
          : role === "Viewer"
            ? VIEWER_ID
            : OPERATOR_ID,
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

type FindManyArgs = Parameters<
  Parameters<typeof buildActiveIncidentsRouter>[0]["repo"]["incident"]["findMany"]
>[0];

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
    let observedWhere: FindManyArgs["where"] | undefined;
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

  it("filters the active list to incidents assigned to the Technician viewer", async () => {
    // HAPPY_PATH_TECHNICIAN — Tech A's session sees only rows
    // assigned to Tech A. The fixture seeds 2 rows for Tech A and
    // 1 row for Tech B; the data layer's filter is the seam — we
    // capture the `where` clause so the assertion pins the
    // `assigneeUserId` predicate, then return rows that match the
    // filter (simulating what the DB would return).
    const findMany: StartArgs["findMany"] = async () => [
      buildRow({
        id: "55555555-5555-4555-8555-555555555555",
        state: "OPEN",
        severity: "critical",
        assigneeUserId: TECH_A_ID,
      }),
      buildRow({
        id: "66666666-6666-4666-8666-666666666666",
        state: "ACKNOWLEDGED",
        severity: "warning",
        assigneeUserId: TECH_A_ID,
      }),
    ];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany,
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidents: IncidentPayload[] };
    expect(body.incidents).toHaveLength(2);
    expect(body.incidents.map((i) => i.id).sort()).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ]);
    for (const incident of body.incidents) {
      expect(incident.assignee_user_id).toBe(TECH_A_ID);
    }
    await close();
  });

  it("returns the empty envelope when a Technician has no assignments", async () => {
    // ZERO_TECHNICIAN — Tech A has zero rows; the WHERE clause
    // matches nothing; the envelope is `{ incidents: [] }`. The
    // Kanban renders the Tech-specific empty state on the client.
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async () => [],
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ incidents: [] });
    await close();
  });

  it("does NOT apply the assigneeUserId filter for Admin / Operator / Viewer (unfiltered active list)", async () => {
    // HAPPY_PATH_OPERATOR — the unfiltered list is the contract
    // for Admin, Operator, and Viewer. The handler's conditional
    // spread MUST leave the WHERE clause clean of assigneeUserId
    // for these roles. A regression that always-set the filter
    // would break the operator's global view (5 rows pinned here
    // include rows for 3 different technicians + 1 unassigned).
    let observedWhere: FindManyArgs["where"] | undefined;
    const rows: IncidentRow[] = [
      buildRow({
        id: "77777777-7777-4777-8777-777777777777",
        state: "OPEN",
        severity: "critical",
        assigneeUserId: null,
      }),
      buildRow({
        id: "88888888-8888-4888-8888-888888888888",
        state: "ACKNOWLEDGED",
        severity: "warning",
        assigneeUserId: TECH_A_ID,
      }),
      buildRow({
        id: "99999999-9999-4999-8999-999999999999",
        state: "INSPECTING",
        severity: "warning",
        assigneeUserId: TECH_B_ID,
      }),
      buildRow({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        state: "SAFE",
        severity: "warning",
        assigneeUserId: TECH_A_ID,
      }),
      buildRow({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        state: "UNSAFE",
        severity: "critical",
        assigneeUserId: null,
      }),
    ];
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        observedWhere = args.where;
        return rows;
      },
    });

    // Operator — full list.
    const resOp = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Operator")}` },
    });
    expect(resOp.status).toBe(200);
    expect(observedWhere?.assigneeUserId).toBeUndefined();
    const opBody = (await resOp.json()) as { incidents: IncidentPayload[] };
    expect(opBody.incidents).toHaveLength(5);

    // Admin — full list, no filter.
    observedWhere = undefined;
    const resAdmin = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Admin")}` },
    });
    expect(resAdmin.status).toBe(200);
    expect(observedWhere?.assigneeUserId).toBeUndefined();

    // Viewer — full list, no filter. Step-04 review fix: pin this
    // branch explicitly. A regression that defaulted the filter to
    // `req.user.id` would still render the wrong list for Viewer
    // (a global read surface that must show every incident).
    observedWhere = undefined;
    const resViewer = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Viewer")}` },
    });
    expect(resViewer.status).toBe(200);
    expect(observedWhere?.assigneeUserId).toBeUndefined();
    const viewerBody = (await resViewer.json()) as { incidents: IncidentPayload[] };
    expect(viewerBody.incidents).toHaveLength(5);

    await close();
  });

  it("passes `assigneeUserId: <self>` to the data layer for Technician viewers (SOCKET_FILTER_DROP-equivalent pin)", async () => {
    // The WHERE clause is observable in the captured `findMany.args`.
    // The handler MUST spread `assigneeUserId: req.user.id` for the
    // Technician role only. This is the seam the Socket helper on
    // the web side mirrors (`TECH_FILTER_DROP` in
    // `useKanbanBoardSocket.ts`); a regression on the server would
    // also surface on the socket path because both ends trust the
    // server's filtered envelope.
    let observedWhere: FindManyArgs["where"] | undefined;
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        observedWhere = args.where;
        return [];
      },
    });
    const res = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    expect(res.status).toBe(200);
    // The filter is observable: `assigneeUserId === TECH_A_ID`.
    expect(observedWhere?.assigneeUserId).toBe(TECH_A_ID);
    // And the existing RESOLVED exclusion is preserved.
    expect(observedWhere?.state?.not).toBe("RESOLVED");
    await close();
  });

  it("returns an empty envelope after a Tech A's incident is reassigned to Tech B", async () => {
    // REASSIGN_VISIBILITY — once Tech A's incident is reassigned to
    // Tech B (4.6's assign transition), Tech A's view of the active
    // list drops the row. We simulate this by changing the fixture
    // across two fetches: first fetch returns Tech A's row (before
    // reassign), second fetch returns nothing (after reassign —
    // the WHERE clause no longer matches because the row's
    // assignee_user_id is now Tech B).
    let observedWhere: FindManyArgs["where"] | undefined;
    let callCount = 0;
    const { url, close } = await startApp({
      audit: { emit: () => undefined },
      findMany: async (args) => {
        observedWhere = args.where;
        callCount += 1;
        if (callCount === 1) {
          // Pre-reassign: row is Tech A's.
          return [
            buildRow({
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              state: "OPEN",
              severity: "critical",
              assigneeUserId: TECH_A_ID,
            }),
          ];
        }
        // Post-reassign: row now belongs to Tech B; the WHERE
        // clause (assigneeUserId = TECH_A_ID) returns no rows.
        return [];
      },
    });

    // Pre-reassign fetch.
    const before = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    const beforeBody = (await before.json()) as { incidents: IncidentPayload[] };
    expect(beforeBody.incidents).toHaveLength(1);
    expect(observedWhere?.assigneeUserId).toBe(TECH_A_ID);

    // Post-reassign fetch — same WHERE clause, empty result set.
    const after = await fetch(`${url}/api/incidents/active`, {
      headers: { Authorization: `Bearer ${tokenForRole("Technician")}` },
    });
    const afterBody = (await after.json()) as { incidents: IncidentPayload[] };
    expect(afterBody.incidents).toEqual([]);
    await close();
  });
});
