/**
 * `PageHeader` — single source of truth for the page-level heading
 * rhythm DESIGN.md §Layout & Spacing pins:
 *
 *   - 16px top margin above the heading
 *   - 24px section gap between the heading and the first card /
 *     content block below it
 *   - 24px page-title size (`text-2xl`), 700 weight (`font-bold`)
 *   - 15px description (`text-md`), 400 weight, `neutral.secondary`
 *
 * Every page (`AuditLogPage`, `ThresholdsPage`, `SimulatorPage`,
 * `AdminNotificationsPage`, `LoginShell`, the `PageStub` factory in
 * `main.tsx`) previously rendered the same `<h1 className="text-2xl
 * font-semibold ..."/>` + description pair inline, with subtle drifts
 * (`mb-2` vs no margin, `font-semibold` 600 vs DESIGN.md's 700). This
 * component locks the rhythm AND the weight in one place.
 *
 * The optional `actions` slot is right-aligned, so admin pages can
 * hang a primary button or a count badge without bespoke flexbox
 * work at every call site.
 *
 * The component renders a plain `<div>` (no header element) so it
 * nests safely inside page-level containers without contributing a
 * second `<header>` per page (the existing region headers stay
 * semantic; this renders the heading + description + slot triad).
 */
import { type ReactNode } from "react";

export interface PageHeaderProps {
  /** Page title. Required. Renders as `<h1>`. */
  readonly title: string;
  /** Optional supporting copy below the title. */
  readonly description?: ReactNode;
  /** Optional right-aligned action slot (button, count, breadcrumb, etc). */
  readonly actions?: ReactNode;
  /**
   * Optional testid. Forwarded to the wrapping div so per-page tests
   * that pin a heading (e.g. `audit-log-page`) keep their existing
   * `getByTestId('<testid>')` lookups. Defaults to
   * `"page-header-<kebab(title)>"`.
   */
  readonly testId?: string;
  /**
   * Optional className for the wrapping div — used by callers that
   * need to flatten the top margin (e.g. the dashboard wraps
   * everything in `flex flex-col gap-4`, where an extra 16px would
   * double up).
   */
  readonly className?: string;
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const PageHeader = ({ title, description, actions, testId, className }: PageHeaderProps) => {
  const resolvedTestId = testId ?? `page-header-${slugify(title)}`;
  const wrapperClassName = className ?? "mt-4 mb-6 flex items-start justify-between gap-4";
  return (
    <div data-testid={resolvedTestId} data-page-header="true" className={wrapperClassName}>
      <div className="min-w-0">
        <h1
          data-testid={`${resolvedTestId}-title`}
          className="text-2xl font-bold text-neutral-body"
        >
          {title}
        </h1>
        {description !== undefined && description !== null && description !== false ? (
          <p
            data-testid={`${resolvedTestId}-description`}
            className="mt-1 text-md text-neutral-secondary"
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined && actions !== null && actions !== false ? (
        <div data-testid={`${resolvedTestId}-actions`} className="flex shrink-0 items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
};
