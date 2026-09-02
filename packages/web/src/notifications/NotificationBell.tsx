/**
 * `NotificationBell` — Story 4.10. Operator-facing bell icon
 * mounted in `TopBar`. Clicking opens a dropdown listing unread
 * notifications for the current viewer; each row has a "Mark
 * as read" affordance. Viewer / RBAC-denied render the shared
 * disabled variant (`data-testid="notification-bell-disabled"`).
 * Dropdown closes on click-outside, Escape, or row-link
 * navigation.
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

const DISABLED_BELL_TESTID = "notification-bell-disabled";
const DISABLED_BELL_TITLE = "Notifications are not available for your role.";

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
  /** Test escape hatch — the bell reads `useToasts()` by default; a
   *  parent may inject its own `pushToast` (e.g. a shared toast
   *  queue via React context in a future Epic-6 sweep). */
  readonly pushToast?: (tone: "success" | "error", message: string) => void;
}

export const NotificationBell = ({ pushToast }: NotificationBellProps = {}) => {
  const role = useCurrentRole();
  const viewerRole: Role = role ?? VIEWER;

  if (viewerRole === VIEWER) {
    return <DisabledNotificationBell />;
  }

  return <ActiveNotificationBell viewerRole={viewerRole} pushToast={pushToast} />;
};

const DisabledNotificationBell = () => (
  <button
    type="button"
    data-testid={DISABLED_BELL_TESTID}
    aria-disabled="true"
    title={DISABLED_BELL_TITLE}
    className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-input text-neutral-disabled"
  >
    <span aria-hidden className="text-lg">
      {"\u2407"}
    </span>
  </button>
);

const ActiveNotificationBell = ({
  viewerRole,
  pushToast: pushToastProp,
}: {
  readonly viewerRole: Role;
  readonly pushToast?: (tone: "success" | "error", message: string) => void;
}) => {
  const { notifications, unreadCount, query } = useNotificationBell(viewerRole);
  // Unconditional call so the hook count is stable across the
  // optional-prop boundary.
  const fallback = useToasts();
  const pushToast = pushToastProp ?? fallback.pushToast;
  const markAsRead = useMarkAsRead(viewerRole, {
    onError: (message: string) => pushToast("error", message),
  });

  // GET_403 → render the disabled variant (NO click-outside effect
  // / dropdown state below; this branch must precede any later hook
  // call to satisfy React's hook-order guard).
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
        className="relative inline-flex min-h-touch min-w-touch items-center justify-center rounded-input text-neutral-body hover:bg-neutral-page"
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
