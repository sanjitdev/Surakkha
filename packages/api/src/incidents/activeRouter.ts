/**
 * `/api/incidents/active` — Story 4.3.
 *
 * Kanban-facing read endpoint. Returns every non-`RESOLVED` Incident
 * row (state ∈ { OPEN, ACKNOWLEDGED, INSPECTING, SAFE, UNSAFE,
 * MONITORING, REOPENED }) sorted by `opened_at DESC`. No pagination
 * at v1 scale (a few hundred active incidents is the upper bound
 * per the spec's "Ask First: pagination" decision).
 *
 * RBAC: `authorize({ action: "read", resource: "Incident" }, audit)`
 * — every authenticated role can read (matrix grants `Incident.read`
 * to all four v1 roles). Technician ownership enforcement is
 * deferred to a follow-up (the matrix rows that restrict a
 * Technician to assigned incidents apply to the per-incident read,
 * not the list — the v1 Kanban shows every active incident to
 * every authenticated role; the technician-filtered view is Story
 * 4.12).
 *
 * The wire row is the existing `IncidentPayloadSchema` — no new
 * wire shape. The Kanban UI's column projection lives in
 * `@surakkha/shared/incident` (`projectKanbanColumn(state, severity)`)
 * and is computed client-side at consumption time; this endpoint
 * just emits the raw rows sorted by opened_at DESC.
 *
 * Story 2.6's `/api/incidents/recent` is unchanged — it remains the
 * dashboard's bounded preview (default limit=10, 24h window). The
 * active endpoint is a sibling, not a replacement.
 */
import { type IncidentPayload, type IncidentState } from "@surakkha/shared/incident";
import express, { type Response, type Router } from "express";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type IncidentRow,
  incidentRowToPayload,
  type IncidentStateRepository,
} from "./incidentStateRepository.js";

const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;

/**
 * The set of states the active board surfaces. RESOLVED is excluded
 * by the `state: { not: "RESOLVED" }` filter at the query level — a
 * resolved incident transitions off the board (the spec's
 * "RESOLVED_DROP" edge case in the I/O matrix). The projection
 * already returns "RESOLVED" for { RESOLVED, SAFE, MONITORING }
 * (see `projectKanbanColumn`); we filter at the SQL level too so the
 * payload never carries a RESOLVED row, even if the projection
 * extended.
 */
const RESOLVED: IncidentState = "RESOLVED";

export interface ActiveIncidentsDeps {
  readonly audit: AuditLogger;
  /**
   * Injectable data layer. Production wires the narrow Prisma
   * `IncidentStateRepository` slice (via `routerWiring.ts`); tests
   * pass a stub that returns canned `IncidentRow[]` (or an empty
   * array for the empty-DB case).
   */
  readonly repo: Pick<IncidentStateRepository, "incident">;
}

/**
 * Build the `/api/incidents/active` router. Mounted AFTER
 * `authenticate` in `packages/api/src/index.ts` so the
 * `req.user.role` context is populated.
 */
export const buildActiveIncidentsRouter = (deps: ActiveIncidentsDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/incidents/active",
    authorize({ action: "read", resource: "Incident" }, deps.audit),
    async (_req: AuthorizedRequest, res: Response) => {
      let rows: IncidentRow[];
      try {
        rows = await deps.repo.incident.findMany({
          where: { state: { not: RESOLVED } },
          orderBy: { openedAt: "desc" },
        });
      } catch (err) {
        console.error("api/incidents/active: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      const body: { incidents: IncidentPayload[] } = {
        incidents: rows.map((row) => incidentRowToPayload(row)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  return router;
};
