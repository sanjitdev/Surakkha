/**
 * `/api/incidents/active` — Kanban-facing read endpoint. Returns
 * every non-`RESOLVED` Incident row sorted by `opened_at DESC`.
 * No pagination at v1 scale.
 */
import { type IncidentPayload, type IncidentState } from "@surakkha/shared/incident";
import express, { type Response, type Router } from "express";

import { type AuditLogger } from "../audit.js";
import { ERROR_CODES } from "../errors.js";
import { HTTP_INTERNAL_ERROR, HTTP_OK } from "../httpStatus.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type IncidentRow,
  incidentRowToPayload,
  type IncidentStateRepository,
} from "./incidentStateRepository.js";

/** RESOLVED is excluded by the `state: { not: "RESOLVED" }` filter
 *  at the query level — a resolved incident transitions off the
 *  board. The SQL-level filter guarantees the payload never carries
 *  a RESOLVED row even if the column projection extended. */
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
    async (req: AuthorizedRequest, res: Response) => {
      // Technician viewer filter: a Technician sees only incidents
      // assigned to them; the rest get the unfiltered active list.
      // Defensive `req.user` check — a Tech request missing id
      // would match every row if we filtered by `undefined`, which
      // is worse than the non-Tech case. Surface 500 on the
      // malformed-auth path so misconfiguration doesn't mask as a
      // partial-ok.
      const role = req.user?.role;
      const userId = req.user?.id;
      if (role === "Technician" && userId === undefined) {
        console.error("api/incidents/active: Technician request missing user id");
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
        return;
      }
      const techFilter = role === "Technician" ? { assigneeUserId: userId as string } : {};
      let rows: IncidentRow[];
      try {
        rows = await deps.repo.incident.findMany({
          where: { state: { not: RESOLVED }, ...techFilter },
          orderBy: { openedAt: "desc" },
        });
      } catch (err) {
        console.error("api/incidents/active: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
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
