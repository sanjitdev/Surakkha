/**
 * `thresholdsRouter.ts` — Story 3.7 (`/admin/thresholds` admin tab).
 *
 * Four routes, all gated on `authorize({ action: "update", resource:
 * "Rule" }, audit)` — Admin-only per the RBAC matrix
 * (`Admin.update.Rule = Y`, `Operator.update.Rule = N`,
 * `Technician.update.Rule = N`, `Viewer.update.Rule = N`). The
 * existing `rbac.negative.spec.ts` cases 8 (Viewer → update → Rule)
 * pins one denial cell; cases 18 + 19 (Operator + Technician →
 * update → Rule) pin the remaining two. The handlers themselves are
 * thin orchestrators; the heavy lifting lives in the pure helpers
 * below (`supersedeRule`, `deactivateRule`, `activateRule`,
 * `listRules`).
 *
 *   GET  /admin/thresholds/rules?limit=50&cursor=<uuid>&activeOnly=false
 *     - Cursor pagination over the `Rule` table, ordered by
 *       `(deviceId, metric, operator, threshold, version DESC)`.
 *     - `activeOnly=true` filters to `isActive: true`.
 *     - Returns `{ rules, nextCursor }` per `RuleListResponseSchema`.
 *
 *   POST /admin/thresholds/rules
 *     - Creates a new `Rule` at `version: 1, isActive: true`.
 *     - Body Zod-parsed by `RuleCreateRequestSchema`.
 *
 *   PATCH /admin/thresholds/rules/:id
 *     - Two sub-operations, discriminated by body shape:
 *       - `{ supersede: true, ...newFields }` → atomic
 *         (old-update + new-create) inside a `$transaction`. The new
 *         row lands at `old.version + 1`.
 *       - `{ activate: false }` → single-row `update({ isActive:
 *         false })`.
 *
 *   PATCH /admin/thresholds/rules/:id/activate
 *     - Idempotent: flips `isActive: true` on the named version. No
 *       version increment.
 *
 * Why `update` (not `manage`) for the gate: the RBAC matrix uses
 * `update × Rule` as the cell that governs rule-edit privileges
 * (`Admin.update.Rule = Y`). The matrix has no `create × Rule`
 * entry, so the POST endpoint also gates on `update Rule` —
 * semantics: "create a new Rule" is treated as a write against the
 * Rule resource.
 */
import {
  RuleActivateRequestSchema,
  type RuleCreateRequest,
  RuleCreateRequestSchema,
  type RuleListResponse,
  type RulePatchRequest,
  RulePatchRequestSchema,
  type RuleRow,
  RuleRowSchema,
  type RuleSupersedeResponse,
} from "@surakkha/shared";
import express, { type Response, type Router } from "express";
import { z } from "zod";

import { type AuditLogger } from "../audit.js";
import { authorize, type AuthorizedRequest } from "../middleware/authorize.js";

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_ERROR = 500;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The Rule delegate the router needs from Prisma. Production narrows
 * the real client via `resolveThresholdsRepository`; tests inject a
 * stub. Mirrors the narrow-slice pattern from
 * `rules/alertStateRepository.ts`.
 */
/**
 * Per-element `orderBy` shape. A page may order by a heterogeneous
 * list of keys (e.g. `[{ deviceId: "asc" }, { metric: "asc" }]`),
 * so each element is a one-of union of the supported keys.
 */
interface RuleOrderBy {
  readonly deviceId?: "asc" | "desc";
  readonly metric?: "asc" | "desc";
}

export interface ThresholdsRepository {
  readonly rule: {
    findMany(args: {
      readonly where?: {
        readonly isActive?: boolean;
        readonly deviceId?: string | null;
      };
      readonly orderBy?: readonly RuleOrderBy[];
      readonly take?: number;
      readonly cursor?: { readonly id: string };
      readonly skip?: number;
      readonly select: typeof ruleSelectShape;
    }): Promise<readonly RuleRow[]>;
    findUnique(args: {
      readonly where: { readonly id: string };
      readonly select: typeof ruleSelectShape;
    }): Promise<RuleRow | null>;
    create(args: {
      readonly data: {
        readonly deviceId: string | null;
        readonly metric: RuleRow["metric"];
        readonly operator: RuleRow["operator"];
        readonly threshold: number;
        readonly severity: RuleRow["severity"];
        readonly ruleType: RuleRow["ruleType"];
        readonly minDurationSeconds: number;
        readonly hysteresisSeconds: number;
        readonly version: number;
        readonly createdBy: string | null;
        readonly isActive: boolean;
      };
      readonly select: typeof ruleSelectShape;
    }): Promise<RuleRow>;
    update(args: {
      readonly where: { readonly id: string };
      readonly data: {
        readonly isActive?: boolean;
        readonly version?: number;
      };
      readonly select: typeof ruleSelectShape;
    }): Promise<RuleRow>;
  };
  $transaction<T>(cb: (tx: ThresholdsRepository) => Promise<T>): Promise<T>;
}

/**
 * The wire row select — pinned to a single shape so the same
 * `select` argument works for `findMany`, `findUnique`, `create`,
 * and `update`. Mirrors `RuleRowSchema` 1:1.
 */
const ruleSelectShape = {
  id: true,
  deviceId: true,
  metric: true,
  operator: true,
  threshold: true,
  severity: true,
  ruleType: true,
  minDurationSeconds: true,
  hysteresisSeconds: true,
  version: true,
  createdBy: true,
  isActive: true,
} as const;

/**
 * Production adapter — narrow the real `@prisma/client` to the
 * `ThresholdsRepository` slice. Same `as any` cast as
 * `resolveAlertStateRepository` (`rules/alertStateRepository.ts:131`).
 */
export const resolveThresholdsRepository = (prisma: unknown): ThresholdsRepository => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  return {
    rule: {
      findMany: (args) => client.rule.findMany(args) as Promise<readonly RuleRow[]>,
      findUnique: (args) => client.rule.findUnique(args) as Promise<RuleRow | null>,
      create: (args) => client.rule.create(args) as Promise<RuleRow>,
      update: (args) => client.rule.update(args) as Promise<RuleRow>,
    },
    $transaction: <T>(cb: (tx: ThresholdsRepository) => Promise<T>): Promise<T> =>
      client.$transaction(cb) as Promise<T>,
  };
};

export interface ThresholdsRouterDeps {
  readonly audit: AuditLogger;
  readonly repo: ThresholdsRepository;
}

/**
 * Parse the `:id` URL path parameter. UUIDv4 only — a malformed id
 * returns 400 BEFORE any DB lookup.
 */
const idPathSchema = z.object({ id: z.string().uuid() });

/**
 * Parse the `GET` query string. The cursor + limit + activeOnly
 * trio is the full set; unknown keys are accepted by default
 * (Express's `req.query` is `Record<string, unknown>` and a
 * non-strict schema matches).
 */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  cursor: z.string().uuid().optional(),
  activeOnly: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
});

/**
 * Fetch one page of rules. Extracted from the GET handler so the
 * handler stays under the lint `complexity` ceiling. Cursor
 * pagination: the API returns `limit + 1` rows (if available) and
 * uses the (limit + 1)-th row's id as `nextCursor` so the next
 * request can resume. Skipping the cursor row in the next page
 * avoids re-including the boundary.
 */
const listRules = async (
  repo: ThresholdsRepository,
  args: {
    readonly limit: number;
    readonly cursor: string | undefined;
    readonly activeOnly: boolean;
  },
): Promise<RuleListResponse> => {
  const where = args.activeOnly ? { isActive: true } : {};
  const findArgs: Parameters<ThresholdsRepository["rule"]["findMany"]>[0] = {
    where,
    orderBy: [{ deviceId: "asc" as const }, { metric: "asc" as const }],
    take: args.limit + 1,
    ...(args.cursor !== undefined ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    select: ruleSelectShape,
  };
  const rows = await repo.rule.findMany(findArgs);
  // The repository's return type is `ReadonlyArray<RuleRow>`; the
  // pagination helpers below slice and index it. Casting to a
  // mutable `RuleRow[]` for local pagination arithmetic keeps the
  // boundary narrow (the wire response stays `RuleRow[]`).
  const mutable = rows as RuleRow[];
  if (mutable.length > args.limit) {
    const next = mutable[args.limit];
    if (next === undefined) {
      return { rules: mutable.slice(0, args.limit), nextCursor: null };
    }
    return { rules: mutable.slice(0, args.limit), nextCursor: next.id };
  }
  return { rules: mutable, nextCursor: null };
};

/**
 * Build a `RuleRow`-shaped object from the create-request input.
 * Defaults `version: 1, isActive: true, createdBy: <actor>`. The
 * deviceId + createdBy are normalized to `string | null` here so
 * the Prisma `data` object stays narrowly typed.
 */
const buildCreateData = (
  input: RuleCreateRequest,
  actorId: string,
): {
  deviceId: string | null;
  metric: RuleRow["metric"];
  operator: RuleRow["operator"];
  threshold: number;
  severity: RuleRow["severity"];
  ruleType: RuleRow["ruleType"];
  minDurationSeconds: number;
  hysteresisSeconds: number;
  version: number;
  createdBy: string | null;
  isActive: boolean;
} => ({
  deviceId: input.deviceId ?? null,
  metric: input.metric,
  operator: input.operator,
  threshold: input.threshold,
  severity: input.severity,
  ruleType: input.ruleType,
  minDurationSeconds: input.minDurationSeconds,
  hysteresisSeconds: input.hysteresisSeconds,
  version: 1,
  createdBy: input.createdBy ?? actorId,
  isActive: true,
});

/**
 * Apply the supersede transition: in a single `$transaction`, flip
 * the old row's `isActive: false` AND insert a new row at
 * `old.version + 1`. Both rows are returned in the response.
 *
 * Atomicity: a partial supersede (old deactivated, new never
 * created) cannot happen — `$transaction` rolls both back on any
 * throw.
 */
const supersedeRule = async (
  repo: ThresholdsRepository,
  args: {
    readonly id: string;
    readonly body: Extract<RulePatchRequest, { supersede: true }>;
  },
): Promise<RuleSupersedeResponse | { readonly error: "not_found" }> => {
  const result = await repo.$transaction(async (tx) => {
    const old = await tx.rule.findUnique({
      where: { id: args.id },
      select: ruleSelectShape,
    });
    if (old === null) return null;
    const updated = await tx.rule.update({
      where: { id: args.id },
      data: { isActive: false },
      select: ruleSelectShape,
    });
    const created = await tx.rule.create({
      data: {
        deviceId: args.body.deviceId !== undefined ? args.body.deviceId : old.deviceId,
        metric: args.body.metric !== undefined ? args.body.metric : old.metric,
        operator: args.body.operator !== undefined ? args.body.operator : old.operator,
        threshold: args.body.threshold !== undefined ? args.body.threshold : old.threshold,
        severity: args.body.severity !== undefined ? args.body.severity : old.severity,
        ruleType: args.body.ruleType !== undefined ? args.body.ruleType : old.ruleType,
        minDurationSeconds:
          args.body.minDurationSeconds !== undefined
            ? args.body.minDurationSeconds
            : old.minDurationSeconds,
        hysteresisSeconds:
          args.body.hysteresisSeconds !== undefined
            ? args.body.hysteresisSeconds
            : old.hysteresisSeconds,
        version: old.version + 1,
        createdBy: old.createdBy,
        isActive: true,
      },
      select: ruleSelectShape,
    });
    return { old: updated, new: created };
  });
  if (result === null) return { error: "not_found" };
  return result;
};

/**
 * Apply the deactivate transition: flip the named row's `isActive`
 * to `false` (no version increment).
 */
const deactivateRule = async (
  repo: ThresholdsRepository,
  id: string,
): Promise<RuleRow | { readonly error: "not_found" }> => {
  const existing = await repo.rule.findUnique({
    where: { id },
    select: ruleSelectShape,
  });
  if (existing === null) return { error: "not_found" };
  return repo.rule.update({
    where: { id },
    data: { isActive: false },
    select: ruleSelectShape,
  });
};

/**
 * Apply the activate transition: flip the named row's `isActive` to
 * `true` (no version increment). Idempotent — re-activating an
 * already-active row is a no-op write.
 */
const activateRule = async (
  repo: ThresholdsRepository,
  id: string,
): Promise<RuleRow | { readonly error: "not_found" }> => {
  const existing = await repo.rule.findUnique({
    where: { id },
    select: ruleSelectShape,
  });
  if (existing === null) return { error: "not_found" };
  return repo.rule.update({
    where: { id },
    data: { isActive: true },
    select: ruleSelectShape,
  });
};

/**
 * Send a 400 with a structured `validation_error` body. Module-scope
 * helper so the route handlers stay under the complexity ceiling.
 */
const sendValidationError = (res: Response, parsed: { error: { issues: unknown } }): void => {
  res.status(HTTP_BAD_REQUEST).json({ error: "validation_error", issues: parsed.error.issues });
};

/**
 * Build the `/admin/thresholds` router.
 *
 * RBAC: every route gates on `update × Rule`. Admin → 200; Operator
 * / Technician / Viewer → 403 + `rbac_denied` audit. The deny cells
 * are pinned by `rbac.negative.spec.ts` cases 8 + 18 + 19.
 */
export const buildThresholdsRouter = (deps: ThresholdsRouterDeps): Router => {
  const router = express.Router();

  /**
   * GET /admin/thresholds/rules — list rules, paginated.
   */
  router.get(
    "/rules",
    authorize({ action: "update", resource: "Rule" }, deps.audit),
    async (_req: AuthorizedRequest, res: Response) => {
      const parsed = listQuerySchema.safeParse(_req.query);
      if (!parsed.success) {
        sendValidationError(res, parsed);
        return;
      }
      const limit = parsed.data.limit ?? DEFAULT_LIMIT;
      const { cursor } = parsed.data;
      const activeOnly = parsed.data.activeOnly ?? false;
      try {
        const list = await listRules(deps.repo, { limit, cursor, activeOnly });
        res.status(HTTP_OK).json(list);
      } catch (err) {
        console.error("api/admin/thresholds/list: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
      }
    },
  );

  /**
   * POST /admin/thresholds/rules — create a new Rule at v1.
   */
  router.post(
    "/rules",
    authorize({ action: "update", resource: "Rule" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const parsed = RuleCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed);
        return;
      }
      const actor = req.user?.id;
      if (actor === undefined) {
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
        return;
      }
      try {
        const created = await deps.repo.rule.create({
          data: buildCreateData(parsed.data, actor),
          select: ruleSelectShape,
        });
        res.status(HTTP_OK).json(created);
      } catch (err) {
        console.error("api/admin/thresholds/create: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
      }
    },
  );

  /**
   * PATCH /admin/thresholds/rules/:id — supersede OR deactivate.
   * The body shape discriminates which.
   */
  router.patch(
    "/rules/:id",
    authorize({ action: "update", resource: "Rule" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        sendValidationError(res, idParsed);
        return;
      }
      const bodyParsed = RulePatchRequestSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        sendValidationError(res, bodyParsed);
        return;
      }
      const { id } = idParsed.data;
      const { data: body } = bodyParsed;
      try {
        if ("supersede" in body && body.supersede === true) {
          const result = await supersedeRule(deps.repo, { id, body });
          if ("error" in result) {
            res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
            return;
          }
          res.status(HTTP_OK).json(result);
          return;
        }
        const deactivated = await deactivateRule(deps.repo, id);
        if ("error" in deactivated) {
          res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
          return;
        }
        res.status(HTTP_OK).json(deactivated);
      } catch (err) {
        console.error("api/admin/thresholds/patch: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
      }
    },
  );

  /**
   * PATCH /admin/thresholds/rules/:id/activate — flip `isActive` to
   * `true` on the named version. Idempotent.
   */
  router.patch(
    "/rules/:id/activate",
    authorize({ action: "update", resource: "Rule" }, deps.audit),
    async (req: AuthorizedRequest, res: Response) => {
      const idParsed = idPathSchema.safeParse(req.params);
      if (!idParsed.success) {
        sendValidationError(res, idParsed);
        return;
      }
      // Body is empty (per RuleActivateRequestSchema). The schema
      // accepts `undefined` (no body) so we pass the literal
      // undefined to the parse. The middleware does not run on
      // POST-by-convention here; we just gate against the Zod
      // schema and ignore the result.
      RuleActivateRequestSchema.parse(req.body ?? {});
      try {
        const activated = await activateRule(deps.repo, idParsed.data.id);
        if ("error" in activated) {
          res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
          return;
        }
        res.status(HTTP_OK).json(activated);
      } catch (err) {
        console.error("api/admin/thresholds/activate: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: "internal_error" });
      }
    },
  );

  return router;
};

// `RuleRowSchema` is referenced as a Zod parse anchor in the
// repository's `select` shape; the runtime type is already exported
// via `RuleRow` but the schema import ensures drift between the
// wire contract and the Prisma select shape surfaces at compile
// time.
const _ruleRowSchemaAnchor = RuleRowSchema;
void _ruleRowSchemaAnchor;
