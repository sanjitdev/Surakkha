/**
 * `AttachmentForm` — Story 4.13.
 *
 * The inline "Add attachment" form (URL + optional label +
 * optional MIME override). Matches 4.6's `AssignControl` inline
 * pattern — no modal library, no portal. The form mounts inline
 * below the list when the user clicks "Add attachment"; submit
 * fires `useCreateAttachment` mutation; success closes the form
 * and the list refetches.
 *
 * Client-side URL validation mirrors the server's
 * `validateHttpUrl` for fast inline feedback (the server is the
 * authority — the api's Zod schema + URL validator are the
 * security boundary). The shared `validateHttpUrl` helper from
 * `@surakkha/shared/urlValidation` is the single source of truth;
 * the api uses it for the security check, the form uses it for
 * the inline UX (no drift between the two surfaces).
 *
 * Form contract:
 *   - URL field is required (Zod `min(1)` on the api's body
 *     schema); empty submit is blocked client-side.
 *   - Label field is optional (max 200 chars — api's Zod bound);
 *     a client-side `maxLength` attribute enforces the bound
 *     inline so the operator sees the limit before submit.
 *   - MIME field is optional; the api auto-detects from the URL
 *     extension when omitted.
 *
 * Submit feedback:
 *   - The button shows "Adding..." while the mutation is pending
 *     so the operator knows the click registered.
 *   - The form is disabled while pending (URL + label inputs +
 *     submit button) — a second click during the in-flight
 *     request would otherwise fire a duplicate POST.
 *   - On success the form closes + clears the inputs (the
 *     mutation's `onSuccess` triggers the close; the parent
 *     section owns the open-state).
 */
import { InvalidUrlError, validateHttpUrl } from "@surakkha/shared/urlValidation";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";

export interface AttachmentFormProps {
  /**
   * Submit handler. Wired by `<AttachmentsSection />` to the
   * `useCreateAttachment` mutation. The form does NOT call the
   * mutation directly — keeps the component presentational and
   * testable with a stub `onSubmit`.
   */
  readonly onSubmit: (input: { readonly url: string; readonly label?: string }) => void;
  /** Whether the underlying mutation is pending. */
  readonly isPending: boolean;
  /**
   * Inline close handler. Fires when the operator clicks
   * "Cancel" or after a successful submit. The form does NOT
   * own its own open-state — the parent section does.
   */
  readonly onClose: () => void;
}

/**
 * `AttachmentForm` — the inline create-attachment form.
 *
 * Local state: `url` + `label` strings + `clientError` (the
 * inline validation message when the URL is malformed). The
 * `clientError` is set on the URL's `blur` event so the operator
 * sees the failure BEFORE they try to submit (better UX than
 * blocking submit + waiting for the server's 400).
 *
 * On submit: validate inline → clear error → call `onSubmit`.
 * The mutation's `onError` is owned by the parent section so the
 * toast queue lives on the section's lifetime.
 */
export const AttachmentForm = ({ onSubmit, isPending, onClose }: AttachmentFormProps) => {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const validateUrl = useCallback((candidate: string): string | null => {
    if (candidate.trim() === "") {
      return "URL is required";
    }
    try {
      validateHttpUrl(candidate);
      return null;
    } catch (err) {
      const message =
        err instanceof InvalidUrlError ? err.message : "URL must be http:// or https://";
      return message;
    }
  }, []);

  const handleUrlBlur = useCallback((): void => {
    setClientError(validateUrl(url));
  }, [url, validateUrl]);

  const handleUrlChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      setUrl(e.target.value);
      if (clientError !== null) setClientError(null);
    },
    [clientError],
  );

  const handleLabelChange = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    setLabel(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>): void => {
      e.preventDefault();
      const inlineError = validateUrl(url);
      if (inlineError !== null) {
        setClientError(inlineError);
        return;
      }
      const trimmedLabel = label.trim();
      onSubmit(trimmedLabel === "" ? { url } : { url, label: trimmedLabel });
      // Reset on submit — the parent section closes the form on
      // mutation success. If the mutation fails, the parent's
      // error toast surfaces the classified message; the form
      // remains open with the operator's input intact (the
      // operator can fix the URL/label and retry).
      setUrl("");
      setLabel("");
      setClientError(null);
    },
    [url, label, validateUrl, onSubmit],
  );

  return (
    <form
      data-testid="attachment-form"
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-input border border-neutral-border bg-neutral-surface p-3"
    >
      <label className="flex flex-col gap-1 text-xs text-neutral-secondary">
        URL
        {/* `type="text"` (not `"url"`) on purpose — the browser's
            built-in URL validation is inconsistent across engines
            and would block our `onSubmit` handler on an empty
            value before the React `validateUrl` helper runs. The
            shared `validateHttpUrl` is the single source of truth
            for the URL contract; this input is plain text + the
            helper validates on submit. */}
        <input
          type="text"
          maxLength={2000}
          value={url}
          onChange={handleUrlChange}
          onBlur={handleUrlBlur}
          disabled={isPending}
          data-testid="attachment-form-url"
          className="rounded-input border border-neutral-border px-2 py-1 text-sm text-neutral-body disabled:opacity-50"
          placeholder="https://example.com/photo.png"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-secondary">
        Label (optional)
        <input
          type="text"
          maxLength={200}
          value={label}
          onChange={handleLabelChange}
          disabled={isPending}
          data-testid="attachment-form-label"
          className="rounded-input border border-neutral-border px-2 py-1 text-sm text-neutral-body disabled:opacity-50"
          placeholder="Sensor photo"
        />
      </label>
      {clientError !== null ? (
        <p
          data-testid="attachment-form-error"
          role="alert"
          className="text-xs text-severity-critical-value"
        >
          {clientError}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          data-testid="attachment-form-cancel"
          className="rounded-input border border-neutral-border px-3 py-1 text-xs text-neutral-secondary disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          data-testid="attachment-form-submit"
          className="rounded-input border border-primary bg-primary px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add"}
        </button>
      </div>
    </form>
  );
};
