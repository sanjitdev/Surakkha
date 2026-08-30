/**
 * `index.ts` — Story 4.13 barrel for the attachments surface.
 *
 * Re-exports the public surface of `packages/api/src/attachments/`:
 *   - `buildAttachmentRouter` (the router factory)
 *   - `AttachmentRouterDeps` (the deps shape)
 *   - `AttachmentRepository`, `AttachmentRow` (the data layer)
 *   - `attachmentRowToPayload` (the pure adapter)
 *
 * Mirrors `notifications/index.ts` (4.10) — single barrel for
 * import sites, plus the `mountAttachmentRouter` wiring helper
 * that `src/index.ts` calls at boot.
 *
 * The router + wiring live in this file (not split into separate
 * files) because the attachment surface is small (~3 routes)
 * and the wiring helper is 30 lines. Splitting would force a
 * second file with no load-bearing benefit. If a future story
 * adds a second router (e.g., `attachmentExportRouter`) the
 * barrel + wiring can split then.
 */
export {
  type AttachmentRepository,
  type AttachmentRow,
  resolveAttachmentRepository,
} from "./attachmentRepository.js";

export { attachmentRowToPayload } from "./attachmentRowToPayload.js";

export { type AttachmentRouterDeps, buildAttachmentRouter } from "./attachmentRouter.js";

export { mountAttachmentRouter } from "./routerWiring.js";
