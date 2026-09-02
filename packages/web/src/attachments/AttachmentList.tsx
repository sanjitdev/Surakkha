/**
 * Per-incident attachments read view. Each row shows the label (or
 * the URL when no label), a `↗` external-link icon, the MIME badge
 * (or "unknown" when `mime` is null), the uploader id (or
 * "anonymous"), and an RBAC-gated delete button.
 *
 * The label is rendered as text content (React escapes HTML entities)
 * — no `dangerouslySetInnerHTML`. The URL is rendered via
 * `<a href rel="noopener noreferrer" target="_blank">`; the api
 * rejects `javascript:` / `data:` / `file:` / `vbscript:` schemes
 * via `validateHttpUrl`, and `noopener` mitigates tab-nabbing.
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";

export interface AttachmentListProps {
  readonly attachments: readonly AttachmentPayload[];
  readonly canDelete: (attachment: AttachmentPayload) => boolean;
  readonly onDelete: (id: string) => void;
  readonly isDeleting: (id: string) => boolean;
}

const formatActorOrAnonymous = (id: string | null): string => (id === null ? "anonymous" : id);

const formatMimeOrUnknown = (mime: string | null): string => (mime === null ? "unknown" : mime);

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
