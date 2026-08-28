/**
 * Token store — Surakkha web (Story 1.7).
 *
 * Single source of truth for the SPA's access token. The refresh
 * token lives only in an httpOnly cookie managed by the browser; we
 * never see it from JS.
 *
 * Wire contract:
 *   - `accessToken` is read synchronously by the apiClient (Story 1.7)
 *     before every fetch and by the `CurrentRoleProvider` to derive
 *     the user role.
 *   - `setAccessToken({ token, expiresIn })` is called by the
 *     apiClient on login + refresh success.
 *   - `clearTokens()` is called on refresh failure (the SPA then
 *     navigates to /login).
 *   - The store persists `accessToken` to `localStorage` so a hard
 *     page reload recovers the session without bouncing through
 *     /login.
 *
 * Test affordances:
 *   - `_resetTokenStore()` lets unit tests reset the singleton between
 *     assertions without touching `localStorage`.
 */
import { type Role } from "@surakkha/shared/rbac";
import { create } from "zustand";

import { decodeAccessToken } from "./jwtDecode";

const STORAGE_KEY = "surakkha.access_token";

interface PersistedToken {
  readonly token: string;
  readonly expiresAt: number | null;
}

const readPersisted = (): PersistedToken | null => {
  if (typeof globalThis.localStorage === "undefined") return null;
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof (parsed as { token: unknown }).token === "string"
    ) {
      const expiresAtField = (parsed as { expiresAt?: unknown }).expiresAt;
      const expiresAt =
        typeof expiresAtField === "number" && Number.isFinite(expiresAtField)
          ? expiresAtField
          : null;
      return { token: (parsed as { token: string }).token, expiresAt };
    }
    return null;
  } catch {
    return null;
  }
};

const writePersisted = (state: PersistedToken | null): void => {
  if (typeof globalThis.localStorage === "undefined") return;
  if (state === null) {
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export interface TokenState {
  readonly accessToken: string | null;
  readonly expiresAt: number | null;
  readonly setAccessToken: (input: { token: string; expiresIn: number }) => void;
  readonly clearTokens: () => void;
}

const computeExpiresAt = (now: number, expiresIn: number): number => now + expiresIn * 1000;

export const useTokenStore = create<TokenState>((set) => {
  const persisted = readPersisted();
  return {
    accessToken: persisted?.token ?? null,
    expiresAt: persisted?.expiresAt ?? null,
    setAccessToken: ({ token, expiresIn }) => {
      const expiresAt = computeExpiresAt(Date.now(), expiresIn);
      writePersisted({ token, expiresAt });
      set({ accessToken: token, expiresAt });
    },
    clearTokens: () => {
      writePersisted(null);
      set({ accessToken: null, expiresAt: null });
    },
  };
});

/**
 * Read role from the current access token. Synchronous; used by
 * `CurrentRoleContext` for the initial render so the route gate does
 * not flash before the JWT is decoded.
 */
export const readRoleFromStore = (): Role | null => {
  const { accessToken } = useTokenStore.getState();
  if (accessToken === null) return null;
  return decodeAccessToken(accessToken).role;
};

/**
 * Read the viewer's user id from the current access token's `sub`
 * claim. Synchronous; mirrors `readRoleFromStore`. Story 4.7 needs
 * this so the detail page can pass `viewerUserId` to
 * `actionSlotsFor`'s third argument (the INSPECTING ownership gate
 * — Technicians only see `submit-result` for incidents they're
 * assigned to).
 */
export const readUserIdFromStore = (): string | null => {
  const { accessToken } = useTokenStore.getState();
  if (accessToken === null) return null;
  return decodeAccessToken(accessToken).userId;
};

/**
 * Read the raw access token. Used by the apiClient for the
 * `Authorization: Bearer <token>` header. Synchronous.
 */
export const readAccessToken = (): string | null => useTokenStore.getState().accessToken;

/**
 * Test helper. Resets the singleton store and the persisted entry.
 * Production callers should use `clearTokens()` instead.
 */
export const _resetTokenStore = (): void => {
  useTokenStore.setState({ accessToken: null, expiresAt: null });
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  }
};
