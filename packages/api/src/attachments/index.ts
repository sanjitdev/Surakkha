/** Barrel for the attachments/ directory. Re-exports the router,
 *  wiring helper, repository slice, and row-to-payload adapter for
 *  the api entry's mounting. */
export {
  type AttachmentRepository,
  type AttachmentRow,
  resolveAttachmentRepository,
} from "./attachmentRepository.js";

export { attachmentRowToPayload } from "./attachmentRowToPayload.js";

export { type AttachmentRouterDeps, buildAttachmentRouter } from "./attachmentRouter.js";

export { mountAttachmentRouter } from "./routerWiring.js";
