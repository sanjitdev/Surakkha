/**
 * Admin audit-lens read view at `/admin/notifications`. Renders the
 * most-recent 100 Notification rows with severity multi-select chips
 * (info / warning / critical) and a date-range selector (24h / 7d /
 * 30d; custom is a deferred no-op stub).
 *
 * Wrapped in `<RbacRoute>` so a non-Admin direct URL hit renders
 * `<RbacDenied />`. The hook's `queryFn` throws
 * `AdminNotificationsRbacDeniedError` on 403; the page's `isError`
 * branch renders the same surface as defense-in-depth.
 */
import {
  type AdminNotificationPayload,
  type NotificationSeverity,
} from "@surakkha/shared/notification";
import { useMemo, useState } from "react";

import { RbacDenied } from "../access/RbacDenied";
import { useCurrentRole } from "../auth/CurrentRoleContext";
import { AdminNotificationsRbacDeniedError } from "../notifications/AdminNotificationsRbacDeniedError";
import {
  type AdminNotificationFilters,
  useAdminNotificationList,
} from "../notifications/useAdminNotificationList";

const SEVERITY_ORDER: readonly NotificationSeverity[] = ["critical", "warning", "info"];

type DateRangePreset = "24h" | "7d" | "30d" | "custom";
const DATE_RANGE_PRESETS: readonly DateRangePreset[] = ["24h", "7d", "30d", "custom"];

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1_000;
const WINDOW_DAYS_24H = 1;
const WINDOW_DAYS_7D = 7;
const WINDOW_DAYS_30D = 30;
const WINDOW_MS_24H =
  WINDOW_DAYS_24H * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const WINDOW_MS_7D =
  WINDOW_DAYS_7D * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const WINDOW_MS_30D =
  WINDOW_DAYS_30D * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

const ID_SHORT_PREFIX_LENGTH = 8;
const ISO_DATETIME_PREFIX_LENGTH = 19;

/** `custom` returns `undefined` (no auto-fill; date inputs are deferred). */
const sincePresetMsForPreset = (preset: DateRangePreset): number | undefined => {
  if (preset === "custom") return undefined;
  if (preset === "24h") return WINDOW_MS_24H;
  if (preset === "7d") return WINDOW_MS_7D;
  return WINDOW_MS_30D;
};

const SEVERITY_DOT_CLASS: Record<NotificationSeverity, string> = {
  critical: "bg-severity-critical-value",
  warning: "bg-severity-warning-value",
  info: "bg-primary",
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

const RECIPIENT_PILL_CLASS: Record<string, string> = {
  Admin: "bg-severity-critical-bg text-severity-critical-text",
  Operator: "bg-severity-warning-bg text-severity-warning-text",
  Technician: "bg-severity-healthy-bg text-severity-healthy-text",
  Viewer: "bg-neutral-bg text-neutral-secondary",
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toISOString().replace("T", " ").slice(0, ISO_DATETIME_PREFIX_LENGTH);
};

const toggleSeverity = (
  current: readonly NotificationSeverity[],
  next: NotificationSeverity,
): readonly NotificationSeverity[] =>
  current.includes(next) ? current.filter((s) => s !== next) : [...current, next];

export interface AdminNotificationsPageProps {
  readonly testId?: string;
}

export const AdminNotificationsPage = ({
  testId = "admin-notifications-page",
}: AdminNotificationsPageProps) => {
  const [severity, setSeverity] = useState<readonly NotificationSeverity[]>([]);
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // `severity` is the FULL array (not collapsed) so 2- and 3-chip
  // selections produce a coherent `?severity=critical&severity=warning`
  // URL. `sincePresetMs` (a window length) is passed instead of a
  // frozen `since` so the hook re-derives `since = now - sincePresetMs`
  // on every fetch and the lower bound slides forward during 30s
  // polling. Memoized on `[severity, preset]` so the reference is
  // stable across re-renders that don't actually change filters;
  // without `useMemo` the IIFE would churn TanStack's queryKey.
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

  const viewerRole = useCurrentRole();

  if (query.isError && query.error instanceof AdminNotificationsRbacDeniedError) {
    return <RbacDenied viewerRole={viewerRole} />;
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
        {/* eslint-disable-next-line react/forbid-dom-props -- id is the aria-labelledby target. */}
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
                className={`inline-block size-2 rounded-full ${SEVERITY_DOT_CLASS[s]}`}
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
        {/* eslint-disable-next-line react/forbid-dom-props -- id is the aria-labelledby target. */}
        <h2 id="date-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Range
        </h2>
        {DATE_RANGE_PRESETS.map((p) => {
          // `custom` is a no-op v1 stub — disabled with both a title
          // (hover) and an `aria-describedby` (AT/announce) so
          // keyboard users learn the constraint without hovering.
          const isStub = p === "custom";
          return (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => setPreset(p)}
              disabled={isStub}
              aria-describedby={isStub ? "range-custom-coming-soon" : undefined}
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
        {/* eslint-disable-next-line react/forbid-dom-props -- id is the aria-describedby target. */}
        <span id="range-custom-coming-soon" className="sr-only">
          Custom date range inputs are deferred to a future story.
        </span>
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
          {severity.length === 0 && preset === "30d"
            ? "No notifications in the last 30 days."
            : "No notifications match the current filters."}
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
            className={`inline-block size-2 rounded-full ${SEVERITY_DOT_CLASS[row.severity]}`}
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
          // eslint-disable-next-line react/forbid-dom-props -- id is the aria-controls target.
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
