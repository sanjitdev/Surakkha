/**
 * `AttachmentsSection` — Story 4.13.
 *
 * The orchestrator mounted on `<IncidentDetailPage />` below the
 * audit timeline. Renders the read-side `<AttachmentList />` plus
 * the inline `<AttachmentForm />` (button-gated for non-Viewer
 * roles). Empty state renders "No attachments yet." (mirrors the
 * audit-timeline's empty-state copy shape).
 *
 * Wire shape (canonical from `@surakkha/shared/attachment`):
 *
 *   GET    /api/incidents/:id/attachments  → AttachmentListEnvelope
 *   POST   /api/incidents/:id/attachments  → AttachmentPayload (201) / error (4xx/5xx)
 *   DELETE /api/attachments/:id            → 204 / error (4xx/5xx)
 *
 * RBAC contract:
 *   - Viewer: list is visible (read-only); the "Add attachment"
 *     button AND per-row delete buttons are absent (matrix
 *     `create.Attachment = N` + the per-row ownership gate).
 *     The form mounts only for Admin / Operator / Technician.
 *   - Admin: full create + delete any (matrix `delete.Attachment
 *     = Y` for Admin; the per-row check is "Admin bypasses").
 *   - Operator / Technician: create + delete own (matrix grants
 *     `create`; per-row check `uploadedByUserId === self`).
 *
 * The section receives `incidentId` as a prop (not from
 * `useParams`) so it's testable with a stub id and reusable on
 * future surfaces (e.g., a per-event attachment panel in a
 * follow-up story).
 *
 * Tailwind-class constraint (Story 2.8 VG-1 lesson): every class
 * string here is a literal. Template-literal interpolation would
 * silently leave the class out of the JIT bundle.
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
  /**
   * The parent incident's id. Passed as a prop (not read from
   * `useParams`) so the section is testable with a stub id and
   * reusable on future surfaces.
   */
  readonly incidentId: string;
  /**
   * Optional test escape hatch — the section reads `useToasts()`
   * by default, but a parent may inject its own `pushToast` so
   * the section can share the parent's toast queue (avoids two
   * separate `useToasts` instances whose state doesn't sync).
   * The toast region itself is owned by each page mount, not
   * the section.
   */
  readonly pushToast?: (tone: "success" | "error", message: string) => void;
}

/**
 * `AttachmentsSection` — the read + create + delete orchestrator.
 *
 * State owned here:
 *   - `formOpen` (boolean) — toggled by the "Add attachment"
 *     button. Local state because the form's lifecycle is
 *     scoped to the section mount, not the parent page.
 *
 * Hooks owned here:
 *   - `useAttachments(incidentId)` — the list query.
 *   - `useCreateAttachment(incidentId)` — the create mutation.
 *   - `useDeleteAttachment(incidentId)` — the delete mutation.
 *   - `useToasts()` — the page-scoped toast queue; the section
 *     wires `pushToast` into both mutations so the failure
 *     messages live on the section's lifetime.
 *
 * RBAC helpers (closure-captured):
 *   - `canCreate` — true when `role !== Viewer`. Admin /
 *     Operator / Technician all see the "Add attachment" button.
 *   - `canDelete(attachment)` — true when the role is Admin OR
 *     the viewer uploaded the row. This is the per-row ownership
 *     gate that mirrors the api's `enforceDeleteOwnership`
 *     helper (4.13 `attachmentRouter.ts:enforceDeleteOwnership`).
 *     Keeping this client-side means a malicious Operator who
 *     tampers with the DOM still gets a 403 from the api — the
 *     server is the security boundary.
 */
export const AttachmentsSection = ({
  incidentId,
  pushToast: pushToastProp,
}: AttachmentsSectionProps) => {
  const role = useCurrentRole();
  const viewerUserId = useCurrentUserId();
  // `useCurrentRole` may be `null` (unauthenticated). Treat that as
  // Viewer (no create + no delete affordance; the auth gate handles
  // real unauthenticated navigation separately).
  // `useToasts()` is consumed only when no external `pushToast` was
  // injected — keeps the hook count stable across the optional-prop
  // boundary (always either 0 or 1 call to `useToasts`, never
  // conditional). React's hook-order guard requires this.
  const fallback = useToasts();
  const pushToast = pushToastProp ?? fallback.pushToast;
  const { attachments, query } = useAttachments(incidentId);
  const [formOpen, setFormOpen] = useState(false);
  // Pending delete ids (kept as a Set so the list can disable
  // the per-row button while the mutation is in flight). The set
  // is keyed on the attachment id; multiple concurrent deletes
  // stay independent.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Viewer gating: when no role is set (unauthenticated), fall
  // back to Viewer (no create + no delete affordance).
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
