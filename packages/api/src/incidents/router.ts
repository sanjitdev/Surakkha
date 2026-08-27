/**
 * `/api/incidents/:id/...` — Story 4.2 transition router.
 *
 * Six routes:
 *
 *   POST /api/incidents/:id/acknowledge  — OPEN → ACKNOWLEDGED
 *   POST /api/incidents/:id/assign       — OPEN | ACKNOWLEDGED → INSPECTING
 *   POST /api/incidents/:id/submit-result— INSPECTING → SAFE | UNSAFE | MONITORING
 *   POST /api/incidents/:id/resolve      — SAFE | UNSAFE | MONITORING → RESOLVED
 *   POST /api/incidents/:id/reopen       — RESOLVED → OPEN
 *   GET  /api/incidents/:id              — read-side; consumes
 *                                          `IncidentPayloadSchema`.
 *
 * RBAC per the matrix (`packages/shared/src/rbac.ts`):
 *
 *   - acknowledge: Admin, Operator (NOT Technician, NOT Viewer)
 *   - assign: Admin, Operator (NOT Technician, NOT Viewer)
 *   - submit_result: Technician ONLY, AND must be the assignee
 *                    (enforced via `requireOwner`)
 *   - resolve: Admin, Operator (NOT Technician, NOT Viewer)
 *   - reopen: Admin ONLY (NOT Operator, NOT Technician, NOT Viewer)
 *
 * State machine:
 *
 *   The route layer is thin — it parses the body, calls the pure
 *   `transition()` function from `./transitions.ts`, then calls
 *   the `applyTransition()` writer from
 *   `./incidentStateRepository.ts`. RBAC is enforced BEFORE
 *   `transition()` runs. The pure function is role-blind.
 *
 * Atomicity:
 *
 *   `applyTransition` runs (incident update + event create +
 *   optional notification create) inside a single `$transaction`.
 *   Optimistic concurrency on `updatedAt` rejects concurrent
 *   writers with HTTP 409.
 *
 * AC4 (AI-3.2 closure): every successful transition emits a
 * `console.warn({ event: "incident_transition", ... })` log line.
 *
 * Helpers (`runTransitionPipeline`, `computeTransition`, etc.)
 * live in `./transitionHelpers.ts` so this file stays under the
 * lint `max-lines: 500` ceiling.
 */
import {
  type ActionVerb,
  type IncidentEventPayload,
  type IncidentPayload,
} from "@surakkha/shared/incident";
import { type Action } from "@surakkha/shared/rbac";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

import {
  type IncidentEventRow,
  incidentEventRowToPayload,
  type IncidentRow,
  incidentRowToPayload,
  type IncidentStateRepository,
} from "./incidentStateRepository.js";
import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_INTERNAL_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  type PrepareCtxInput,
  prepareTransitionContext,
  respondSuccess,
  runTransitionPipeline,
  type TransitionContext,
} from "./transitionHelpers.js";

const idPathSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Dependencies the router needs from the surrounding app. Slim
 * interface so the test rig can wire stubs (mocked `repo` +
 * capture-ready `audit`).
 */
export interface IncidentsRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: IncidentStateRepository;
  /**
   * The broadcast target for socket emits. Production wires
   * `io.to(...)`; tests pass a stub that records emissions.
   * Optional: omitting it disables the socket emit (used by the
   * unit-test rig where the broadcast surface is irrelevant).
   */
  readonly broadcast?: IncidentBroadcast;
  /**
   * Patch (code review 2026-08-27 #18): lazy-upsert a `User` row
   * on first JWT sight so audit writes do not fail with FK
   * violations when an unrecognized `sub` claim appears (e.g.
   * SSO-provisioned users not yet in the seed). Optional: omitting
   * it falls back to `req.user?.id ?? null` (the JWT's `sub` claim
   * directly). Production wires the helper from `src/index.ts`;
   * the test rig omits it because it stubs `req.user` directly.
   */
  readonly resolveActorUserId?: (jwtSub: string | null) => Promise<string | null>;
}

/**
 * The narrow broadcast surface the router needs. Mirrors the
 * `BroadcastTarget` from `rules/applyTransition.ts` so the
 * production wiring is the same code path.
 */
export interface IncidentBroadcast {
  readonly to: (room: string) => {
    readonly emit: (event: "incident:state_changed" | "incident:opened", payload: unknown) => void;
  };
}

const buildAcknowledgeHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "acknowledge");

const buildAssignHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "assign");

const buildSubmitResultHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "submit_result");

const buildResolveHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "resolve");

const buildReopenHandler = (
  deps: IncidentsRouterDeps,
): ((req: AuthorizedRequest, res: Response) => Promise<void>) =>
  buildTransitionHandler(deps, "reopen");

/**
 * The RBAC action each verb gates on. Mirrors the per-verb entries
 * in `RBAC_MATRIX` (e.g. `Admin.acknowledge.Incident = Y`,
 * `Technician.submit_result.Incident = Y`). Story 1.1's lint rule
 * (`pnpm lint:rbac`) catches any new verb that doesn't have a
 * matching matrix entry.
 */
const RBAC_ACTION_BY_VERB: Readonly<Record<ActionVerb, Action>> = {
  acknowledge: "acknowledge",
  assign: "assign",
  submit_result: "submit_result",
  resolve: "resolve",
  reopen: "reopen",
};

/**
 * Build the per-verb transition handler. The verb determines:
 *   - Which body schema to apply
 *   - Which RBAC action to gate on
 *   - Whether the assignee ownership check applies (submit_result
 *     only, Technician-only-mine)
 *   - Whether the `notification:critical` write site fires
 *     (submit_result → UNSAFE)
 */
const buildTransitionHandler =
  (deps: IncidentsRouterDeps, verb: ActionVerb) =>
  async (req: AuthorizedRequest, res: Response): Promise<void> => {
    const ctx = await prepareTransitionContext({ deps, verb, req, res });
    if (ctx === null) return;
    const { id, body, currentRow } = ctx;

    const pipeline = await runTransitionPipeline({
      deps,
      verb,
      id,
      body,
      currentRow,
      req,
      res,
    });
    if (pipeline === null) return;
    const { applied, result } = pipeline;

    // Patch (code review 2026-08-27 #18): resolve the actor via
    // the lazy-upsert helper when wired (production). Falls back
    // to the JWT `sub` claim in the test rig where the helper is
    // omitted. Lazy-upsert is defense-in-depth against FK
    // violations on audit writes for users not yet seeded.
    const actorUserId =
      deps.resolveActorUserId === undefined
        ? (req.user?.id ?? null)
        : await deps.resolveActorUserId(req.user?.id ?? null);

    // Patch (code review 2026-08-27 #13): delegate to
    // `respondSuccess` instead of inlining the AC4 log + emit +
    // 200 response. The helper is the canonical path; the inline
    // copy was a duplicate that risked drift.
    respondSuccess({
      deps,
      currentRow,
      result,
      verb,
      actorUserId,
      applied,
      res,
    });
  };

/**
 * Build the `/api/incidents` router. Mounted AFTER `authenticate`
 * in `packages/api/src/index.ts`.
 */
export const buildIncidentsRouter = (deps: IncidentsRouterDeps): Router => {
  const router = express.Router();

  // Read-side. RBAC: `read × Incident`. All four v1 roles can read;
  // Technician's ownership rule (only assigned) is enforced via
  // `requireOwner` on the resolved `assignee_user_id`.
  router.get(
    "/api/incidents/:id",
    authorize({ action: "read", resource: "Incident" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res
          .status(HTTP_BAD_REQUEST)
          .json({ error: "validation_error", issues: idParsed.error.issues });
        return;
      }
      const { id } = idParsed.data;
      let row: IncidentRow | null;
      try {
        row = await deps.repo.incident.findUnique({ where: { id } });
      } catch (err) {
        console.error(`api/incidents/${id}: findUnique failed`, err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      if (row === null) {
        res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
        return;
      }
      // Technician-only-mine ownership check.
      // Patch (code review 2026-08-27 #11): remove the
      // `row.assigneeUserId !== null` short-circuit so unassigned
      // incidents are also restricted (Technicians only see
      // incidents they're assigned to).
      if (req.user?.role === "Technician" && row.assigneeUserId !== req.user.id) {
        deps.audit.emit({
          auditAction: "rbac_denied",
          userId: req.user.id,
          outcome: "failure",
          context: {
            subject: "Technician",
            action: "read",
            resource: "Incident",
            reason: "not_assignee",
          },
        });
        res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: "Technician" });
        return;
      }
      const payload: IncidentPayload = incidentRowToPayload(row);
      res.status(HTTP_OK).json(payload);
    },
  );

  // Story 4.4 — read-side timeline endpoint. Returns every
  // `IncidentEvent` row for the parent incident in chronological
  // order. RBAC + Tech-ownership mirror the parent GET: a Tech
  // requesting the timeline of an incident they're NOT assigned
  // to gets 403 (the Tech's audit-timeline view is restricted to
  // their assigned incidents).
  //
  // Why a separate endpoint instead of embedding in the parent
  // GET response: the parent GET stays small (one row); the
  // timeline can be paginated / filtered independently in the
  // future. See `spec-4-4-incident-detail-page.md` Design Notes.
  router.get(
    "/api/incidents/:id/events",
    authorize({ action: "read", resource: "Incident" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        res
          .status(HTTP_BAD_REQUEST)
          .json({ error: "validation_error", issues: idParsed.error.issues });
        return;
      }
      const { id } = idParsed.data;
      let row: IncidentRow | null;
      try {
        row = await deps.repo.incident.findUnique({ where: { id } });
      } catch (err) {
        console.error(`api/incidents/${id}/events: findUnique failed`, err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      if (row === null) {
        res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
        return;
      }
      // Technician-only-mine ownership check (same shape as the
      // parent GET; the Tech's audit-timeline view is restricted
      // to incidents they're assigned to per code-review Patch
      // #11 from Story 4.2).
      if (req.user?.role === "Technician" && row.assigneeUserId !== req.user.id) {
        deps.audit.emit({
          auditAction: "rbac_denied",
          userId: req.user.id,
          outcome: "failure",
          context: {
            subject: "Technician",
            action: "read",
            resource: "Incident",
            reason: "not_assignee",
          },
        });
        res.status(HTTP_FORBIDDEN).json({ error: "forbidden", required_role: "Technician" });
        return;
      }
      let events: IncidentEventRow[];
      try {
        events = await deps.repo.incidentEvent.findMany({
          where: { incidentId: id },
          orderBy: { createdAt: "asc" },
        });
      } catch (err) {
        console.error(`api/incidents/${id}/events: findMany failed`, err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      const body: { events: IncidentEventPayload[] } = {
        events: events.map((row_) => incidentEventRowToPayload(row_)),
      };
      res.status(HTTP_OK).json(body);
    },
  );

  // Write-side. RBAC per verb:
  //   - acknowledge: Admin + Operator (NOT Technician, NOT Viewer)
  //   - assign:      Admin + Operator
  //   - submit_result: Technician ONLY (with ownership)
  //   - resolve:     Admin + Operator
  //   - reopen:      Admin ONLY
  router.post(
    "/api/incidents/:id/acknowledge",
    authorize({ action: RBAC_ACTION_BY_VERB.acknowledge, resource: "Incident" }, deps.audit),
    buildAcknowledgeHandler(deps),
  );
  router.post(
    "/api/incidents/:id/assign",
    authorize({ action: RBAC_ACTION_BY_VERB.assign, resource: "Incident" }, deps.audit),
    buildAssignHandler(deps),
  );
  router.post(
    "/api/incidents/:id/submit-result",
    authorize({ action: RBAC_ACTION_BY_VERB.submit_result, resource: "Incident" }, deps.audit),
    buildSubmitResultHandler(deps),
  );
  router.post(
    "/api/incidents/:id/resolve",
    authorize({ action: RBAC_ACTION_BY_VERB.resolve, resource: "Incident" }, deps.audit),
    buildResolveHandler(deps),
  );
  router.post(
    "/api/incidents/:id/reopen",
    authorize({ action: RBAC_ACTION_BY_VERB.reopen, resource: "Incident" }, deps.audit),
    buildReopenHandler(deps),
  );

  // Patch (code review 2026-08-27 #12): removed cargo-cult
  // `_requireOwnerMarker` and `_applyTransitionMarker` declarations.
  // TypeScript's `noUnusedLocals` rule already enforces import
  // usage; the markers added runtime bytes without value. The
  // runtime ownership check lives inline in `runOwnershipCheck`
  // (`transitionHelpers.ts:526-546`).

  return router;
};

// Re-export the helper types + interfaces so the test rig can
// import them from `./router.js` without reaching into
// `./transitionHelpers.js` directly.
export type { PrepareCtxInput, TransitionContext };
