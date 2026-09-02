/**
 * Read + create + delete orchestrator for the per-incident attachments.
 * Mounted on `<IncidentDetailPage />` below the audit timeline.
 *
 * RBAC contract:
 *   - Viewer: list visible (read-only); create + delete buttons absent.
 *   - Admin: full create + delete any.
 *   - Operator / Technician: create + delete own (per-row ownership).
 *
 * `incidentId` is a prop (not from `useParams`) so the section is
 * testable with a stub id and reusable on future per-entity panels.
 * `pushToast` is optional — when omitted the section reads `useToasts()`
 * directly; the toast region itself is owned by each page mount.
 */
import { type AttachmentPayload } from "@surakkha/shared/attachment";
import { type Role } from "@surakkha/shared/rbac";
import { useCallback, useState } from "react";

import { useCurrentRole, useCurrentUserId } from "../auth/CurrentRoleContext";
import { useToasts } from "../incidents/toast";

import { AttachmentForm } from "./AttachmentForm";
import { AttachmentList } from "./AttachmentList";
import { useAttachments } from "./useAttachments";
import { useCreateAttachment } from "./useCreateAttachment";
import { useDeleteAttachment } from "./useDeleteAttachment";

const VIEWER: Role = "Viewer";
const ADMIN: Role = "Admin";

export interface AttachmentsSectionProps {
  readonly incidentId: string;
  readonly pushToast?: (tone: "success" | "error", message: string) => void;
}

export const AttachmentsSection = ({
  incidentId,
  pushToast: pushToastProp,
}: AttachmentsSectionProps) => {
  const role = useCurrentRole();
  const viewerUserId = useCurrentUserId();
  // `useCurrentRole` may be `null` (unauthenticated); fall back to
  // Viewer (no create + no delete affordance). The auth gate handles
  // real unauthenticated navigation separately.
  // `useToasts()` is consumed only when no external `pushToast` was
  // injected — keeps the hook count stable across the optional-prop
  // boundary. React's hook-order guard requires this.
  const fallback = useToasts();
  const pushToast = pushToastProp ?? fallback.pushToast;
  const { attachments, query } = useAttachments(incidentId);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const viewerRole: Role = role ?? VIEWER;
  const canCreate = viewerRole !== VIEWER;

  const createMutation = useCreateAttachment(incidentId, {
    onError: (message: string) => pushToast("error", message),
  });
  const deleteMutation = useDeleteAttachment(incidentId, {
    onError: (message: string) => pushToast("error", message),
  });

  const canDelete = useCallback(
    (attachment: AttachmentPayload): boolean => {
      if (viewerRole === ADMIN) return true;
      return attachment.uploaded_by_user_id === viewerUserId;
    },
    [viewerRole, viewerUserId],
  );

  const isDeleting = useCallback(
    (id: string): boolean => pendingDeleteIds.has(id),
    [pendingDeleteIds],
  );

  const handleFormOpen = useCallback((): void => {
    setFormOpen(true);
  }, []);

  const handleFormClose = useCallback((): void => {
    setFormOpen(false);
  }, []);

  const handleFormSubmit = useCallback(
    (input: { readonly url: string; readonly label?: string }): void => {
      createMutation.mutate(input, {
        onSuccess: () => {
          setFormOpen(false);
        },
      });
    },
    [createMutation],
  );

  const handleDelete = useCallback(
    (id: string): void => {
      setPendingDeleteIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      deleteMutation.mutate(id, {
        onSettled: () => {
          setPendingDeleteIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        },
      });
    },
    [deleteMutation],
  );

  // 403 from the list endpoint (Tech-ownership row check) — render
  // an inline "Not authorized" copy so the operator knows the
  // section is RBAC-blocked, not empty.
  if (query.error !== null && query.error.message === "forbidden") {
    return (
      <section data-testid="attachments-section" className="flex flex-col gap-3">
        <h2 className="text-md font-semibold text-neutral-body">Attachments</h2>
        <p
          data-testid="attachments-rbac-denied"
          className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
        >
          Not authorized to view attachments for this incident.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="attachments-section" className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-md font-semibold text-neutral-body">Attachments</h2>
        {canCreate && !formOpen ? (
          <button
            type="button"
            data-testid="attachments-add-button"
            onClick={handleFormOpen}
            className="rounded-input border border-primary px-3 py-1 text-xs text-primary"
          >
            Add attachment
          </button>
        ) : null}
      </header>
      {formOpen ? (
        <AttachmentForm
          onSubmit={handleFormSubmit}
          isPending={createMutation.isPending}
          onClose={handleFormClose}
        />
      ) : null}
      <AttachmentList
        attachments={attachments}
        canDelete={canDelete}
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />
    </section>
  );
};
