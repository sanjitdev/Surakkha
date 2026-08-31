/**
 * `NotificationBell` — Story 4.10.
 *
 * The operator-facing bell icon mounted in `TopBar`. Clicking it
 * opens a dropdown panel listing the unread notifications for the
 * current viewer. Each row shows severity, the linked
 * `incident_id` (clickable → `/incidents/:id`), and a "Mark as
 * read" affordance that hits `PATCH
 * /api/notifications/:id/acknowledge`. A red unread-count badge
 * overlays the bell icon.
 *
 * Visual contract:
 *   - Bell icon (lucide-style inline SVG) — no third-party icon dep.
 *   - Red badge `<span data-testid="notification-bell-badge">N</span>`
 *     when `unreadCount > 0`; no badge when count === 0.
 *   - Dropdown panel: `role="dialog"`, `aria-label="Notifications"`.
 *   - Severity rows render with the existing severity color tokens:
 *     `text-severity-critical-value` for `critical`,
 *     `text-severity-warning-value` for `warning`, default for
 *     `info`.
 *
 * RBAC contract:
 *   - For Viewer: returns
 *     `<button data-testid="notification-bell-disabled"
 *     aria-disabled="true" title="Notifications are not available
 *     for your role." />`. NO badge, NO dropdown, NO click handler.
 *   - For Admin / Operator / Technician: returns the active bell +
 *     badge + dropdown panel.
 *
 * Dropdown close-on: (a) click outside, (b) Escape key,
 * (c) clicking a row's incident link (navigates → panel unmounts
 * with the route change).
 *
 * Tailwind-class constraint: every class string here is a literal.
 * Story 2.8's `VG-1` lesson — the JIT scanner matches complete
 * literals only; template-literal interpolation would silently
 * leave the class out of the bundle.
 */
import { type NotificationPayload, type NotificationSeverity } from "@surakkha/shared/notification";
import { type Role } from "@surakkha/shared/rbac";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { useCurrentRole } from "../auth/CurrentRoleContext";
import { useToasts } from "../incidents/toast";

import { NotificationsRbacDeniedError } from "./NotificationsRbacDeniedError";
import { useMarkAsRead } from "./useMarkAsRead";
import { useNotificationBell } from "./useNotificationBell";

const VIEWER: Role = "Viewer";

/**
 * The disabled-bell testid + tooltip. Extracted so the Viewer's
 * static disabled surface and the GET_403 dynamic disabled surface
 * render the SAME DOM contract (the spec's `GET_403` row pins
 * "Bell renders disabled state (same as `VIEWER_DISABLED`)").
 */
const DISABLED_BELL_TESTID = "notification-bell-disabled";
const DISABLED_BELL_TITLE = "Notifications are not available for your role.";

/**
 * Severity row border class. Maps the closed enum to the existing
 * `border-severity-{level}-value` design tokens. Literal class
 * strings only (Story 2.8 VG-1 lesson).
 */
const SEVERITY_BORDER_CLASS: Record<NotificationSeverity, string> = {
  info: "border-severity-healthy-value",
  warning: "border-severity-warning-value",
  critical: "border-severity-critical-value",
};

const SEVERITY_TEXT_CLASS: Record<NotificationSeverity, string> = {
  info: "text-severity-healthy-value",
  warning: "text-severity-warning-value",
  critical: "text-severity-critical-value",
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

/**
 * Format a notification's `createdAt` ISO string into a short
 * "Xm ago" / "Xh ago" relative-time string for the dropdown rows.
 * Pure helper (no React), easy to pin in tests.
 */
const formatRelative = (iso: string, nowMs: number = Date.now()): string => {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const deltaMs = nowMs - ts;
  if (deltaMs < 0) return iso;
  const MS_PER_MINUTE = 60_000;
  const MS_PER_HOUR = 3_600_000;
  const MS_PER_DAY = 86_400_000;
  if (deltaMs < MS_PER_MINUTE) return "just now";
  if (deltaMs < MS_PER_HOUR) return `${Math.floor(deltaMs / MS_PER_MINUTE)}m ago`;
  if (deltaMs < MS_PER_DAY) return `${Math.floor(deltaMs / MS_PER_HOUR)}h ago`;
  return `${Math.floor(deltaMs / MS_PER_DAY)}d ago`;
};

/**
 * Pure helper — group severity styling for a single row. Extracted
 * so the dropdown rows read at one place. Literal class strings
 * only.
 */
const severityClasses = (
  severity: NotificationSeverity,
): {
  readonly border: string;
  readonly text: string;
} => ({
  border: SEVERITY_BORDER_CLASS[severity] ?? "border-severity-healthy-value",
  text: SEVERITY_TEXT_CLASS[severity] ?? "text-severity-healthy-value",
});

interface NotificationRowProps {
  readonly notification: NotificationPayload;
  readonly onMarkAsRead: (id: string) => void;
  readonly isPending: boolean;
}

/**
 * `NotificationRow` — single dropdown row. Severity dot + label +
 * incident link + relative-time + "Mark as read" button.
 *
 * Clicking the incident link closes the dropdown via React
 * Router's `<Link>` unmount cycle (NAV_FROM_ROW matrix row).
 */
const NotificationRow = ({ notification, onMarkAsRead, isPending }: NotificationRowProps) => {
  const classes = severityClasses(notification.severity);
  const hasIncident = notification.incidentId !== null;
  return (
    <li
      data-testid={`notification-row-${notification.id}`}
      data-severity={notification.severity}
      className={`flex items-center justify-between gap-3 border-l-4 px-3 py-2 ${classes.border}`}
    >
      <div className="flex flex-col gap-1">
        <span
          className={`text-xs font-semibold uppercase ${classes.text}`}
          data-testid={`notification-row-severity-${notification.id}`}
        >
          {SEVERITY_LABEL[notification.severity]}
        </span>
        {hasIncident ? (
          <Link
            to={`/incidents/${notification.incidentId ?? ""}`}
            data-testid={`notification-row-incident-link-${notification.id}`}
            className="text-sm text-primary underline"
          >
            {notification.incidentId ?? ""}
          </Link>
        ) : (
          <span className="text-sm text-neutral-secondary">
            {notification.alertId ?? "No linked incident"}
          </span>
        )}
        <span className="text-xs text-neutral-secondary">
          {formatRelative(notification.createdAt)}
        </span>
      </div>
      <button
        type="button"
        data-testid={`notification-row-mark-read-${notification.id}`}
        disabled={isPending}
        onClick={() => onMarkAsRead(notification.id)}
        className="rounded-input border border-primary px-2 py-1 text-xs text-primary disabled:opacity-50"
      >
        Mark as read
      </button>
    </li>
  );
};

interface NotificationDropdownProps {
  readonly isOpen: boolean;
  readonly notifications: readonly NotificationPayload[];
  readonly onClose: () => void;
  readonly onMarkAsRead: (id: string) => void;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
}

/**
 * `NotificationDropdown` — the bell's open-panel surface.
 *
 * Closes on:
 *   - (a) Click outside (handled by the parent's `useEffect`
 *         `mousedown` listener)
 *   - (b) Escape key (`useEffect` below)
 *   - (c) Clicking a row's incident link (React Router navigation
 *         unmounts the dropdown with the route change —
 *         `NAV_FROM_ROW` matrix row).
 *
 * Renders:
 *   - Empty list (`ZERO_UNREAD` matrix row): "No new notifications."
 *   - Error state (`GET_500` matrix row): "Unable to load
 *     notifications. Click to retry." + a retry button.
 *   - Normal list: rows in reverse-chronological order (the
 *     data layer's `createdAt DESC` ordering is preserved).
 */
const NotificationDropdown = ({
  isOpen,
  notifications,
  onClose,
  onMarkAsRead,
  isPending,
  isError,
  onRetry,
}: NotificationDropdownProps) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape key — close-on-Escape matrix row.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      data-testid="notification-dropdown"
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 z-40 mt-2 w-80 rounded-card border border-neutral-border bg-neutral-surface shadow-elevation-card"
    >
      <header className="flex items-center justify-between border-b border-neutral-border px-3 py-2">
        <h2 className="text-sm font-semibold text-neutral-body">Notifications</h2>
        <button
          type="button"
          data-testid="notification-dropdown-close"
          aria-label="Close notifications"
          onClick={onClose}
          className="text-xs text-neutral-secondary hover:text-neutral-body"
        >
          ×
        </button>
      </header>
      {isError ? (
        <div
          data-testid="notification-dropdown-error"
          className="flex flex-col gap-2 px-3 py-4 text-center"
        >
          <p className="text-sm text-neutral-body">Unable to load notifications.</p>
          <button
            type="button"
            data-testid="notification-dropdown-retry"
            onClick={onRetry}
            className="self-center rounded-input border border-primary px-3 py-1 text-xs text-primary"
          >
            Retry
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <p
          data-testid="notification-dropdown-empty"
          className="px-3 py-6 text-center text-sm text-neutral-secondary"
        >
          No new notifications.
        </p>
      ) : (
        <ul
          data-testid="notification-dropdown-list"
          className="flex max-h-96 flex-col divide-y divide-neutral-border overflow-y-auto"
        >
          {notifications.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onMarkAsRead={onMarkAsRead}
              isPending={isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export interface NotificationBellProps {
  /**
   * Optional test escape hatch — the bell reads `useToasts()` by
   * default, but a parent may inject its own `pushToast` (e.g. a
   * shared toast queue via React context in a future Epic-6 sweep).
   * Default: `useToasts().pushToast`. The bell does NOT consume
   * `toasts` from this prop — the toast region is owned by each
   * page mount, not the bell.
   */
  readonly pushToast?: (tone: "success" | "error", message: string) => void;
}

/**
 * `NotificationBell` — the bell icon + badge + dropdown mount.
 *
 * For Viewer: returns the disabled variant with `aria-disabled="true"`
 * and a `title` tooltip. NO click handler, NO dropdown.
 *
 * For Admin / Operator / Technician: returns the active bell +
 * badge + dropdown. The unread query polls every 30s via
 * `refetchInterval` so the badge increments without user action
 * (see `useNotificationBell.ts` for the polling rationale).
 */
export const NotificationBell = ({ pushToast }: NotificationBellProps = {}) => {
  const role = useCurrentRole();
  // `useCurrentRole` may be `null` (unauthenticated). Treat that as
  // Viewer (no bell surface; the auth gate handles real
  // unauthenticated navigation separately).
  const viewerRole: Role = role ?? VIEWER;

  if (viewerRole === VIEWER) {
    return <DisabledNotificationBell />;
  }

  return <ActiveNotificationBell viewerRole={viewerRole} pushToast={pushToast} />;
};

/**
 * `DisabledNotificationBell` — the shared "no surface" variant.
 *
 * Two sites render it:
 *   - `Viewer` role (RBAC matrix: Viewer.read.Notification = N).
 *   - `GET_403` from `/api/notifications` (the spec's `GET_403`
 *     matrix row: "Bell renders disabled state (same as
 *     `VIEWER_DISABLED`)"; the api rejected the read for some
 *     reason mid-session — defensive, mirrors the KanbanBoard's
 *     RBAC-denied fallback).
 *
 * NO badge, NO click handler, NO query refetch. The user re-
 * tries by logging out + back in (the apiClient clears tokens
 * on a refresh-401).
 */
const DisabledNotificationBell = () => (
  <button
    type="button"
    data-testid={DISABLED_BELL_TESTID}
    aria-disabled="true"
    title={DISABLED_BELL_TITLE}
    className="inline-flex h-11 w-11 items-center justify-center rounded-input text-neutral-secondary opacity-50"
  >
    <span aria-hidden className="text-lg">
      {"\u2407"}
    </span>
  </button>
);

/**
 * `ActiveNotificationBell` — the Admin / Operator / Technician
 * variant. Extracted so the Viewer's disabled surface doesn't
 * mount the TanStack `useQuery` (the `enabled` flag is the
 * primary gate; isolating the hook call keeps the JSX tree
 * shallow).
 */
const ActiveNotificationBell = ({
  viewerRole,
  pushToast: pushToastProp,
}: {
  readonly viewerRole: Role;
  readonly pushToast?: (tone: "success" | "error", message: string) => void;
}) => {
  const { notifications, unreadCount, query } = useNotificationBell(viewerRole);
  // Only call `useToasts` if no external `pushToast` was injected —
  // keeps the hook count stable across the optional-prop boundary
  // (always either 0 calls or 1 call to `useToasts`, never
  // conditional). React's hook-order guard requires this.
  const fallback = useToasts();
  const pushToast = pushToastProp ?? fallback.pushToast;
  const markAsRead = useMarkAsRead(viewerRole, {
    onError: (message: string) => pushToast("error", message),
  });

  // Spec GET_403 — "Bell renders disabled state (same as
  // VIEWER_DISABLED)". The api rejected the read mid-session
  // (token expired, role revoked, etc.). The bell short-circuits
  // to the shared disabled variant BEFORE mounting the click-
  // outside effect / dropdown state, so a hook added to this
  // component below this check would not be called on the
  // disabled path (tripping React's "rendered fewer hooks"
  // guard). If you need another hook here, gate it on the same
  // condition (or wrap this in a sub-component that owns the
  // disabled branch).
  //
  // NO retry affordance — the recovery path is "log out + log
  // back in".
  if (query.error instanceof NotificationsRbacDeniedError) {
    return <DisabledNotificationBell />;
  }

  return (
    <OpenNotificationBell
      viewerRole={viewerRole}
      notifications={notifications}
      unreadCount={unreadCount}
      markAsRead={markAsRead}
      query={query}
    />
  );
};

/**
 * `OpenNotificationBell` — the active surface mounted after the
 * GET_403 gate clears. Extracted so the disabled-bell render
 * path (which lacks the useState/useRef/useEffect trio below)
 * does not share a component identity with the open-bell render
 * path; that would trip React's "rendered fewer hooks" guard on
 * transitions between enabled/disabled.
 */
interface OpenNotificationBellProps {
  readonly viewerRole: Role;
  readonly notifications: readonly NotificationPayload[];
  readonly unreadCount: number;
  readonly markAsRead: ReturnType<typeof useMarkAsRead>;
  readonly query: { readonly isError: boolean; readonly refetch: () => Promise<unknown> };
}

const OpenNotificationBell = ({
  notifications,
  unreadCount,
  markAsRead,
  query,
}: OpenNotificationBellProps) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on click outside (CLICK_OUTSIDE matrix row).
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (wrapperRef.current === null) return;
      if (!wrapperRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const handleBellClick = useCallback((e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    setOpen((cur) => !cur);
  }, []);

  const handleClose = useCallback((): void => {
    setOpen(false);
  }, []);

  const handleMarkAsRead = useCallback(
    (id: string): void => {
      markAsRead.mutate(id);
    },
    [markAsRead],
  );

  const handleRetry = useCallback((): void => {
    void query.refetch();
  }, [query]);

  // The role label shows on the bell's tooltip — keeps the
  // operator aware of which role's notification list they're
  // viewing (defense-in-depth against future role confusion).
  const tooltip = useMemo(
    () => `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`,
    [unreadCount],
  );

  return (
    <div ref={wrapperRef} data-testid="notification-bell-wrapper" className="relative">
      <button
        type="button"
        data-testid="notification-bell"
        aria-label={tooltip}
        aria-expanded={open}
        title={tooltip}
        onClick={handleBellClick}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-input text-neutral-body hover:bg-neutral-page"
      >
        <span aria-hidden className="text-lg">
          {"\u2407"}
        </span>
        {unreadCount > 0 ? (
          <span
            data-testid="notification-bell-badge"
            role="status"
            aria-live="polite"
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-pill bg-severity-critical-fill px-1 text-xs font-semibold text-white"
          >
            {unreadCount}
          </span>
        ) : null}
      </button>
      <NotificationDropdown
        isOpen={open}
        notifications={notifications}
        onClose={handleClose}
        onMarkAsRead={handleMarkAsRead}
        isPending={markAsRead.isPending}
        isError={query.isError}
        onRetry={handleRetry}
      />
    </div>
  );
};
