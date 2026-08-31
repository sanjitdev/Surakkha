/**
 * `AdminNotificationsPage` — Story 5.1.
 *
 * The admin-facing `/admin/notifications` read surface. Renders
 * the most-recent 100 Notification rows in a table with:
 *
 *   - Severity multi-select chips (`info`, `warning`, `critical`).
 *   - A date-range selector (last 24h / 7d / 30d / custom) — v1
 *     surfaces the preset buttons; custom date inputs are deferred
 *     to a follow-up story.
 *   - An expandable row panel that shows the row's metadata as JSON
 *     (id, severity, incidentId, alertId, recipientRole, createdAt,
 *     acknowledgedAt, acknowledgedByUserId) and a link to
 *     `/incidents/{incidentId}` when `incidentId` is set (or a
 *     "no incident" hint when null).
 *
 * The chip row is the Loop-1 fix surface — selecting 2 or 3 chips
 * produces a `severity: readonly NotificationSeverity[]` of length
 * 2 or 3, the hook serializes it as repeated `?severity=` params,
 * and the api coerces it into a Prisma `{ in: [...] }` IN-list.
 *
 * RBAC double-defense:
 *
 *   - Page wrapped in `<RbacRoute>` (Story 1.6) so a non-Admin
 *     direct URL hit renders `<RbacDenied />` without mounting the
 *     hook.
 *   - `queryFn` throws `AdminNotificationsRbacDeniedError` on 403
 *     (mid-session token expiry or matrix drift). The page's
 *     `isError` branch renders `<RbacDenied />` as the defense in
 *     depth fallback.
 *
 * Read-only. No mark-as-read affordance — the bell owns that.
 */
import {
  type AdminNotificationPayload,
  type NotificationSeverity,
} from "@surakkha/shared/notification";
import { useMemo, useState } from "react";

import { RbacDenied } from "../access/RbacDenied";
import { AdminNotificationsRbacDeniedError } from "../notifications/AdminNotificationsRbacDeniedError";
import {
  type AdminNotificationFilters,
  useAdminNotificationList,
} from "../notifications/useAdminNotificationList";

/** Severity chip order — critical first (highest signal). */
const SEVERITY_ORDER: readonly NotificationSeverity[] = ["critical", "warning", "info"];

/** Date-range presets; `custom` is a no-op v1 stub for the date inputs. */
type DateRangePreset = "24h" | "7d" | "30d" | "custom";
const DATE_RANGE_PRESETS: readonly DateRangePreset[] = ["24h", "7d", "30d", "custom"];

/** Date-range window lengths in milliseconds (the `custom` preset has none). */
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const WINDOW_DAYS_24H = 1;
const WINDOW_DAYS_7D = 7;
const WINDOW_DAYS_30D = 30;
const WINDOW_MS_24H =
  WINDOW_DAYS_24H * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const WINDOW_MS_7D =
  WINDOW_DAYS_7D * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const WINDOW_MS_30D =
  WINDOW_DAYS_30D * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

/** Number of hex characters shown for ID columns (8 ≈ 32 bits of entropy). */
const ID_SHORT_PREFIX_LENGTH = 8;

/** Number of characters in an ISO-8601 datetime stamp (yyyy-mm-ddTHH:MM:SS). */
const ISO_DATETIME_PREFIX_LENGTH = 19;

/**
 * Resolve the date-range preset to a window length in milliseconds
 * for the hook to recompute `since` per fetch. Returns undefined
 * for `custom` (no auto-fill) — the date input is deferred.
 *
 * Loop 2 hardening: the hook re-derives `since = now - windowMs`
 * inside `queryFn` so 30s polling slides the lower bound forward.
 */
const sincePresetMsForPreset = (preset: DateRangePreset): number | undefined => {
  if (preset === "custom") return undefined;
  if (preset === "24h") return WINDOW_MS_24H;
  if (preset === "7d") return WINDOW_MS_7D;
  return WINDOW_MS_30D;
};

/** Severity → Tailwind dot color class (mirrors 4.10's SEVERITY_DOT_BG). */
const SEVERITY_DOT_CLASS: Record<NotificationSeverity, string> = {
  critical: "bg-severity-critical-value",
  warning: "bg-severity-warning-value",
  info: "bg-primary",
};

/** Severity → human label. */
const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

/** Recipient-role → pill color class. */
const RECIPIENT_PILL_CLASS: Record<string, string> = {
  Admin: "bg-severity-critical-bg text-severity-critical-text",
  Operator: "bg-severity-warning-bg text-severity-warning-text",
  Technician: "bg-severity-healthy-bg text-severity-healthy-text",
  Viewer: "bg-neutral-bg text-neutral-secondary",
};

/** Format a Date / ISO string for the table. */
const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toISOString().replace("T", " ").slice(0, ISO_DATETIME_PREFIX_LENGTH);
};

/**
 * Toggle a severity in / out of the chip filter. The chip row is
 * multi-select; `severity` is an array. Loop 1 fix: the array is
 * the wire shape end-to-end so 2- and 3-chip selections produce a
 * coherent `?severity=critical&severity=warning` URL.
 */
const toggleSeverity = (
  current: readonly NotificationSeverity[],
  next: NotificationSeverity,
): readonly NotificationSeverity[] =>
  current.includes(next) ? current.filter((s) => s !== next) : [...current, next];

export interface AdminNotificationsPageProps {
  readonly testId?: string;
}

/**
 * The page component. Mirrors the Story 4.4 `IncidentDetailPage`
 * shape: local `useState` for the chip row + date-range UI,
 * `useAdminNotificationList` for the data, defensive error +
 * RBAC branches.
 */
export const AdminNotificationsPage = ({
  testId = "admin-notifications-page",
}: AdminNotificationsPageProps) => {
  const [severity, setSeverity] = useState<readonly NotificationSeverity[]>([]);
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Compose the filter object. Crucially: severity is the FULL
  // array (not a single value or a `length === 1` collapse) — see
  // Loop 1 fix in the spec's Spec Change Log.
  //
  // Loop 2 hardening: pass `sincePresetMs` (a fixed window length)
  // instead of a frozen `since` ISO string. The hook re-derives
  // `since = now - sincePresetMs` on every fetch, so the lower
  // bound slides forward during 30s polling — otherwise the window
  // is frozen at first paint and rows created after the slide are
  // missed.
  //
  // Memoized on `[severity, preset]` so the *reference* is stable
  // across re-renders that don't actually change the filters.
  // Without useMemo the IIFE would return a fresh object every
  // render, which would change TanStack Query's `queryKey` and
  // trigger an infinite refetch loop.
  const filters: AdminNotificationFilters = useMemo<AdminNotificationFilters>(() => {
    const out: AdminNotificationFilters = {};
    if (severity.length > 0) {
      (out as { severity?: readonly NotificationSeverity[] }).severity = severity;
    }
    const ms = sincePresetMsForPreset(preset);
    if (ms !== undefined) {
      (out as { sincePresetMs?: number }).sincePresetMs = ms;
    }
    return out;
  }, [severity, preset]);

  const { notifications, query } = useAdminNotificationList(filters);

  // Defense-in-depth: route-level `<RbacRoute>` already gates the
  // non-Admin path; this branch handles the rare case where the
  // matrix drifts mid-session. Identical class identity to the
  // page-level check.
  if (query.isError && query.error instanceof AdminNotificationsRbacDeniedError) {
    return <RbacDenied />;
  }

  return (
    <div data-testid={testId} className="p-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-body">Notifications</h1>
      <p className="mb-6 text-md text-neutral-secondary">
        Audit-lens view across all roles and acknowledgment states.
      </p>

      <section
        aria-labelledby="severity-filter-heading"
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="severity-filter"
      >
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-labelledby` (ARIA spec). */}
        <h2 id="severity-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Severity
        </h2>
        {SEVERITY_ORDER.map((s) => {
          const pressed = severity.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={pressed}
              onClick={() => setSeverity((cur) => toggleSeverity(cur, s))}
              data-testid={`severity-chip-${s}`}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                pressed
                  ? "border-primary bg-primary text-white"
                  : "border-neutral-border bg-white text-neutral-body"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${SEVERITY_DOT_CLASS[s]}`}
                aria-hidden="true"
              />
              {SEVERITY_LABEL[s]}
            </button>
          );
        })}
      </section>

      <section
        aria-labelledby="date-filter-heading"
        className="mb-6 flex flex-wrap items-center gap-2"
        data-testid="date-range-filter"
      >
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-labelledby` (ARIA spec). */}
        <h2 id="date-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Range
        </h2>
        {DATE_RANGE_PRESETS.map((p) => {
          // Loop 1 review finding E3: the `custom` preset is a
          // no-op v1 stub — clicking it would silently drop the
          // `since` filter and return ALL rows, which is a
          // confusing UX (the user clicks "Custom" expecting a
          // narrower result, gets the broadest). Disable the
          // button with a tooltip until a future story ships the
          // custom date inputs.
          const isStub = p === "custom";
          return (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => setPreset(p)}
              disabled={isStub}
              title={isStub ? "Custom date range inputs are deferred to a future story" : undefined}
              data-testid={`range-${p}`}
              className={`rounded-md border px-3 py-1 text-sm ${
                preset === p
                  ? "border-primary bg-primary text-white"
                  : "border-neutral-border bg-white text-neutral-body"
              } ${isStub ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {p === "24h"
                ? "Last 24h"
                : p === "7d"
                  ? "Last 7d"
                  : p === "30d"
                    ? "Last 30d"
                    : "Custom"}
            </button>
          );
        })}
      </section>

      {query.isLoading ? (
        <div data-testid="admin-notifications-loading" className="text-md text-neutral-secondary">
          Loading notifications…
        </div>
      ) : query.isError ? (
        <div
          data-testid="admin-notifications-error"
          className="text-md text-severity-critical-text"
        >
          Unable to load notifications. Retry shortly.
        </div>
      ) : notifications.length === 0 ? (
        <div data-testid="admin-notifications-empty" className="text-md text-neutral-secondary">
          No notifications match the current filters.
        </div>
      ) : (
        <table className="w-full border-collapse" data-testid="admin-notifications-table">
          <thead>
            <tr className="border-b border-neutral-border text-left text-sm text-neutral-secondary">
              <th className="py-2 pr-4">Severity</th>
              <th className="py-2 pr-4">Recipient</th>
              <th className="py-2 pr-4">Incident</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                row={n}
                isExpanded={expandedId === n.id}
                onToggle={() => setExpandedId((cur) => (cur === n.id ? null : n.id))}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

interface NotificationRowProps {
  readonly row: AdminNotificationPayload;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

const NotificationRow = ({ row, isExpanded, onToggle }: NotificationRowProps) => {
  const acknowledgedLabel =
    row.acknowledgedAt === null
      ? "Unread"
      : `${formatDate(row.acknowledgedAt)}${
          row.acknowledgedByUserId === null
            ? ""
            : ` · ${row.acknowledgedByUserId.slice(0, ID_SHORT_PREFIX_LENGTH)}`
        }`;
  const recipientClass =
    RECIPIENT_PILL_CLASS[row.recipientRole] ?? "bg-neutral-bg text-neutral-secondary";
  return (
    <>
      <tr
        data-testid={`admin-notification-row-${row.id}`}
        onClick={onToggle}
        // Loop 1 review finding E6 + E7: keyboard users must be
        // able to expand rows; screen readers must announce the
        // expansion state. `role="button"` + `tabIndex={0}` + the
        // keydown handler covers keyboard navigation; `aria-expanded`
        // + `aria-controls` link the row to its detail panel.
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={`admin-notification-detail-${row.id}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="cursor-pointer border-b border-neutral-border text-sm text-neutral-body hover:bg-neutral-bg focus:bg-neutral-bg focus:outline focus:outline-2 focus:outline-primary"
      >
        <td className="py-2 pr-4">
          <span
            className={`inline-block h-2 w-2 rounded-full ${SEVERITY_DOT_CLASS[row.severity]}`}
            aria-hidden="true"
          />
          <span className="ml-2">{SEVERITY_LABEL[row.severity]}</span>
        </td>
        <td className="py-2 pr-4">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${recipientClass}`}
            data-testid={`admin-notification-recipient-${row.id}`}
          >
            {row.recipientRole}
          </span>
        </td>
        <td className="py-2 pr-4">
          {row.incidentId === null ? "n/a" : row.incidentId.slice(0, ID_SHORT_PREFIX_LENGTH)}
        </td>
        <td className="py-2 pr-4">{formatDate(row.createdAt)}</td>
        <td className="py-2 pr-4">{acknowledgedLabel}</td>
      </tr>
      {isExpanded && (
        <tr
          // eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-controls` (ARIA spec).
          id={`admin-notification-detail-${row.id}`}
          data-testid={`admin-notification-detail-${row.id}`}
          className="bg-neutral-bg"
        >
          <td colSpan={5} className="px-4 py-3 text-sm">
            <pre className="overflow-auto rounded-md border border-neutral-border bg-white p-3 text-xs">
              {JSON.stringify(
                {
                  id: row.id,
                  severity: row.severity,
                  incidentId: row.incidentId,
                  alertId: row.alertId,
                  recipientRole: row.recipientRole,
                  createdAt: row.createdAt,
                  acknowledgedAt: row.acknowledgedAt,
                  acknowledgedByUserId: row.acknowledgedByUserId,
                },
                null,
                2,
              )}
            </pre>
            <div className="mt-3">
              {row.incidentId === null ? (
                <span
                  data-testid={`admin-notification-no-incident-${row.id}`}
                  className="text-md text-neutral-secondary"
                >
                  No incident linked to this notification.
                </span>
              ) : (
                <a
                  data-testid={`admin-notification-incident-link-${row.id}`}
                  href={`/incidents/${row.incidentId}`}
                  // Loop 1 review finding E15: clicking the
                  // incident link bubbles to the row's `onClick`
                  // (which toggles expansion). The link is
                  // inside a sibling `<tr>` so the toggle does
                  // NOT collapse the row, but `stopPropagation`
                  // is the defensive guard against a future
                  // refactor that nests the link inside the
                  // toggle row.
                  onClick={(e) => e.stopPropagation()}
                  className="text-md text-primary underline"
                >
                  View incident
                </a>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};
