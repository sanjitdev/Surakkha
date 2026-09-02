/**
 * `ErrorState` — shared "failed to load" surface for incident pages.
 *
 * Renders a dashed-border message + a retry button. Pages pass a
 * `testIdPrefix` (e.g. `incident-detail`, `kanban-board`) so the
 * testids stay page-scoped.
 */
interface ErrorStateProps {
  readonly testIdPrefix: string;
  readonly message: string;
  readonly onRetry: () => void;
}

export const ErrorState = ({ testIdPrefix, message, onRetry }: ErrorStateProps) => (
  <div data-testid={`${testIdPrefix}-error-state`} className="flex flex-col gap-3">
    <p
      data-testid={`${testIdPrefix}-error-message`}
      className="rounded-input border border-dashed border-neutral-border p-6 text-center text-sm text-neutral-secondary"
    >
      {message}
    </p>
    <button
      type="button"
      data-testid={`${testIdPrefix}-retry-button`}
      onClick={onRetry}
      className="self-center rounded-input border border-primary px-4 py-2 text-sm text-primary"
    >
      Retry
    </button>
  </div>
);
