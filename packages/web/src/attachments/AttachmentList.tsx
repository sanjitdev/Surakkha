/**
 * `AttachmentList` — Story 4.13.
 *
 * The read-side render of the per-incident attachments. Each
 * `<li>` row shows the label (or the URL itself when no label),
 * a `↗` external-link icon, the MIME badge (or "unknown" when
 * `mime` is null), the uploader's user-id (or "anonymous" when
 * null), and a per-row delete button gated by RBAC.
 *
 * Defensive rendering (per the spec's `XSS_LABEL` row):
 *   - The `label` is rendered as text content via `{label}` —
 *     React escapes HTML entities; no `dangerouslySetInnerHTML`.
 *     An attacker who posts `{ label: "<script>alert(1)</script>" }`
 *     gets the literal text in the DOM, not a script element.
 *   - The URL is rendered via `<a href={url}>` with
 *     `rel="noopener noreferrer"` + `target="_blank"`. The api
 *     enforces `validateHttpUrl` (rejects `javascript:`, `data:`,
 *     `file:`, `vbscript:`); even if a `javascript:` URL slipped
 *     past the server, the `noopener` mitigates tab-nabbing and
 *     the `target="_blank"` keeps the navigation off the SPA.
 *
 * RBAC per-row delete:
 *   - The button is hidden when `canDelete === false` (Viewer
 *     role; OR a non-Admin user viewing another user's row).
 *   - The button is disabled while the mutation is pending so a
 *     double-click doesn't fire two DELETEs.
 *   - The mutation lives in `<AttachmentsSection />`; this
 *     component receives `onDelete(id)` and `isDeleting(id)` as
 *     props so the list stays presentational.
 *
 * Tailwind-class constraint (Story 2.8 VG-1 lesson): every class
 * string here is a literal. Template-literal interpolation would
 * silently leave the class out of the JIT bundle.
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";

export interface AttachmentListProps {
  readonly attachments: readonly AttachmentPayload[];
  /**
   * Per-row RBAC predicate. Returns `true` when the current viewer
   * may delete the row (Admin OR the uploader). The list renders
   * the delete button only when this returns `true`; Viewer
   * viewers get a read-only surface (no buttons).
   */
  readonly canDelete: (attachment: AttachmentPayload) => boolean;
  /**
   * Delete click handler. Wired by `<AttachmentsSection />` to
   * the `useDeleteAttachment` mutation. The list does NOT call
   * the mutation directly — keeps the component presentational
   * and testable with a stub `onDelete`.
   */
  readonly onDelete: (id: string) => void;
  /**
   * Per-row pending flag. Returns `true` while the delete mutation
   * for that specific row is in flight. The button's `disabled`
   * is wired to this so a double-click doesn't fire two DELETEs.
   */
  readonly isDeleting: (id: string) => boolean;
}

const formatActorOrAnonymous = (id: string | null): string => (id === null ? "anonymous" : id);

/**
 * Render the MIME badge. Returns "unknown" when `mime` is null —
 * the api stamps `application/octet-stream` as the server-side
 * default, but the wire field is nullable so a future schema
 * change can omit it without breaking this consumer.
 */
const formatMimeOrUnknown = (mime: string | null): string => (mime === null ? "unknown" : mime);

/**
 * `AttachmentList` — the per-incident attachments renderer.
 *
 * Renders an empty-state placeholder when `attachments.length === 0`
 * (the section's "No attachments yet." copy). Each row links to
 * the attachment URL via `<a rel="noopener noreferrer" target="_blank">`
 * and exposes the label as plain text (no HTML interpretation).
 */
export const AttachmentList = ({
  attachments,
  canDelete,
  onDelete,
  isDeleting,
}: AttachmentListProps) => {
  if (attachments.length === 0) {
    return (
      <p
        data-testid="attachments-list-empty"
        className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
      >
        No attachments yet.
      </p>
    );
  }
  return (
    <ul data-testid="attachments-list" className="flex flex-col gap-2">
      {attachments.map((a) => {
        const label = a.label ?? a.url;
        return (
          <li
            key={a.id}
            data-testid={`attachments-row-${a.id}`}
            data-uploaded-by={a.uploaded_by_user_id ?? "anonymous"}
            className="flex items-center justify-between gap-3 rounded-input border border-neutral-border bg-neutral-surface p-3 text-sm text-neutral-body"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                {/* The `<a>` link uses the URL only — even if a
                    `javascript:` URL slipped past the server
                    (it can't), the `noopener noreferrer` mitigates
                    tab-nabbing and `target="_blank"` keeps the
                    navigation off the SPA. */}
                <a
                  href={a.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  data-testid={`attachments-row-link-${a.id}`}
                  className="truncate text-sm text-primary underline"
                >
                  {label}
                </a>
                <span aria-hidden className="text-xs text-neutral-secondary">
                  {"↗"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-secondary">
                <span data-testid={`attachments-row-mime-${a.id}`}>
                  {formatMimeOrUnknown(a.mime)}
                </span>
                <span>·</span>
                <span>uploaded by {formatActorOrAnonymous(a.uploaded_by_user_id)}</span>
                <span>·</span>
                <time dateTime={a.created_at}>{new Date(a.created_at).toISOString()}</time>
              </div>
            </div>
            {canDelete(a) ? (
              <button
                type="button"
                data-testid={`attachments-row-delete-${a.id}`}
                disabled={isDeleting(a.id)}
                onClick={() => onDelete(a.id)}
                className="shrink-0 rounded-input border border-primary px-2 py-1 text-xs text-primary disabled:opacity-50"
              >
                Delete
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
