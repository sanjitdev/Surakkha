/**
 * `UserMenu` — top-bar identity chip. Shows the viewer's email
 * (captured from the login form into `tokenStore.userEmail`) and the
 * current Role pulled from `CurrentRoleContext`. On click, opens a
 * dropdown with the role label + a Sign out action that clears the
 * token store and bounces the SPA to `/login`.
 *
 * Falls back to "Signed in" + the role label when no email is
 * available (older session, migration from before this field
 * existed) — the chip is always visible so the TopBar never reads
 * as an anonymous surface.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCurrentRole } from "../auth/CurrentRoleContext";
import { useTokenStore } from "../auth/tokenStore";

const ROLE_LABEL: Record<string, string> = {
  Admin: "Admin",
  Operator: "Operator",
  Technician: "Technician",
  Viewer: "Viewer",
};

const initialsFromEmail = (email: string): string => {
  const left = email.split("@")[0] ?? email;
  const parts = left.split(/[._-]+/).filter((p) => p.length > 0);
  if (parts.length === 0) return email.slice(0, 1).toUpperCase();
  if (parts.length === 1) {
    const p = parts[0] ?? "";
    return p.slice(0, 2).toUpperCase();
  }
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
};

export interface UserMenuProps {
  /** Called after the token store is cleared. Receives the navigation
   *  helper so the parent can bounce the SPA to `/login` (keeps the
   *  component decoupled from `react-router-dom`). */
  readonly onSignOut: () => void;
}

export const UserMenu = ({ onSignOut }: UserMenuProps) => {
  const role = useCurrentRole();
  const userEmail = useTokenStore((s) => s.userEmail);
  const clearTokens = useTokenStore((s) => s.clearTokens);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (wrapperRef.current === null) return;
      if (!wrapperRef.current.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignOut = useCallback((): void => {
    clearTokens();
    setOpen(false);
    onSignOut();
  }, [clearTokens, onSignOut]);

  const displayEmail = userEmail ?? "Signed in";
  const displayName = userEmail !== null ? (userEmail.split("@")[0] ?? userEmail) : "Signed in";
  const initials = useMemo(
    () => (userEmail !== null ? initialsFromEmail(userEmail) : "S"),
    [userEmail],
  );
  const roleLabel = role !== null ? (ROLE_LABEL[role] ?? role) : "—";

  return (
    <div ref={wrapperRef} data-testid="user-menu-wrapper" className="relative">
      <button
        type="button"
        data-testid="user-menu"
        aria-label={`Account menu for ${displayEmail}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((cur) => !cur)}
        className="flex min-h-touch items-center gap-2 rounded-input px-2 py-1 text-md text-neutral-body hover:bg-neutral-page"
      >
        <span
          aria-hidden
          data-testid="user-menu-avatar"
          className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
        >
          {initials}
        </span>
        <span className="hidden flex-col items-start leading-tight md:flex">
          <span data-testid="user-menu-email" className="text-sm font-medium text-neutral-body">
            {displayName}
          </span>
          <span data-testid="user-menu-role" className="text-xs text-neutral-secondary">
            {roleLabel}
          </span>
        </span>
        <span aria-hidden className="hidden text-neutral-secondary md:inline">
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          data-testid="user-menu-dropdown"
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-card border border-neutral-border bg-neutral-surface shadow-elevation-card"
        >
          <div className="border-b border-neutral-border px-3 py-2">
            <p className="truncate text-sm font-semibold text-neutral-body">{displayEmail}</p>
            <p className="text-xs text-neutral-secondary">{roleLabel}</p>
          </div>
          <button
            type="button"
            data-testid="user-menu-signout"
            role="menuitem"
            onClick={handleSignOut}
            className="block w-full px-3 py-2 text-left text-sm text-neutral-body hover:bg-neutral-page"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
};
