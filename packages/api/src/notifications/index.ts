/**
 * Barrel for `packages/api/src/notifications/` — Story 4.10.
 *
 * Re-exports the read-side router + repository slice for
 * `packages/api/src/index.ts` mounting. The writer (4.9) lives in
 * the same directory and is mounted transitively via the
 * `incidentStateRepository.ts` import — no explicit barrel for
 * the writer (the writer is internal-only; the public surface of
 * this directory is the 4.10 read surface).
 */
export {
  type NotificationRepository,
  type NotificationRow,
  resolveNotificationRepository,
} from "./notificationRepository.js";
export { buildNotificationRouter, type NotificationRouterDeps } from "./notificationRouter.js";
