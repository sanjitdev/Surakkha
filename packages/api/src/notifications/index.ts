/** Barrel for the read-side surface (router + repository slice). */
export {
  type NotificationRepository,
  type NotificationRow,
  resolveNotificationRepository,
} from "./notificationRepository.js";
export { buildNotificationRouter, type NotificationRouterDeps } from "./notificationRouter.js";
