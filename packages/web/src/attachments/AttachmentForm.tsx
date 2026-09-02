/**
 * Inline "Add attachment" form (URL + optional label). URL validation
 * shares `@surakkha/shared/urlValidation` with the api — the api is
 * the security boundary, this form mirrors it for fast inline
 * feedback. The form is presentational: it does NOT call the mutation
 * directly; the parent `<AttachmentsSection />` wires `onSubmit` to
 * `useCreateAttachment`.
 *
 * Form contract:
 *   - URL required (empty submit is blocked client-side).
 *   - Label optional, `maxLength={200}` matches the api's Zod bound.
 *   - MIME optional (api auto-detects from the URL extension).
 *
 * `type="text"` (not `"url"`) on the URL input — the browser's
 * built-in URL validation is inconsistent across engines and would
 * block submit on empty values before the React `validateUrl` helper
 * runs.
 */
import { InvalidUrlError, validateHttpUrl } from "@surakkha/shared/urlValidation";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";

export interface AttachmentFormProps {
  readonly onSubmit: (input: { readonly url: string; readonly label?: string }) => void;
  readonly isPending: boolean;
  readonly onClose: () => void;
}

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
      // mutation success; on failure, the parent's toast surfaces
      // the classified message and the form keeps the operator's
      // input so they can fix + retry.
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
