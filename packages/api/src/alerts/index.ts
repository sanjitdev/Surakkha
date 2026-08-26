/**
 * Barrel for `packages/api/src/alerts/` — Story 3.5.
 *
 * Mounted in `packages/api/src/index.ts` AFTER the existing incidents
 * router mounts. Each router factory takes a `deps` object so the
 * production `index.ts` wires the real Prisma client + audit logger
 * + broadcast target + injectable clock, while unit tests inject
 * stubs (see `acknowledgeRouter.spec.ts` + `listRouter.spec.ts`).
 */
export {
  type AlertAcknowledgeDeps,
  type AlertAcknowledgeRepository,
  buildAlertAcknowledgeRouter,
  resolveAlertAcknowledgeRepository,
} from "./acknowledgeRouter.js";
export {
  type AlertListDeps,
  type AlertListRepository,
  buildAlertListRouter,
  resolveAlertListRepository,
} from "./listRouter.js";
