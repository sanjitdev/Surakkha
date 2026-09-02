/**
 * Barrel for `packages/api/src/alerts/`. Each route factory takes a
 * `deps` object so the production wiring injects the real Prisma
 * client, audit logger, broadcast target, and injectable clock,
 * while unit tests inject stubs.
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
