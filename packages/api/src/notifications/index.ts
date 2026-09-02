/** Barrel for the notifications/ directory. Re-exports the read-side
 *  router + repository slice for the api entry's mounting. The writer
 *  is internal-only — it's consumed by `applyTransition.ts`'s
 *  auto-create-from-alert path and the submit_result router; no
 *  explicit barrel for it. */
export {
  type NotificationRepository,
  type NotificationRow,
  resolveNotificationRepository,
} from "./notificationRepository.js";
export { buildNotificationRouter, type NotificationRouterDeps } from "./notificationRouter.js";
