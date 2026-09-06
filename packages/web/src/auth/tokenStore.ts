/**
 * `tokenStore` — single source of truth for the SPA's access token.
 * Persisted to `localStorage` so a hard page reload recovers the session
 * without bouncing through /login. The refresh token lives only in an
 * httpOnly cookie; we never see it from JS.
 *
 * `userEmail` is captured from the login form (the user just typed it
 * at the moment of authentication) and persisted alongside the token
 * so the TopBar can greet the viewer on hard-reload without an extra
 * `/me` round-trip. The JWT itself does not carry the email; the
 * store is the only place this metadata lives. A user that clears
 * the access token also clears the email — `clearTokens()` zeros
 * both fields in lockstep.
 */
import { type Role } from "@surakkha/shared/rbac";
import { create } from "zustand";

import { decodeAccessToken } from "./jwtDecode";

const STORAGE_KEY = "surakkha.access_token";

interface PersistedToken {
  readonly token: string;
  readonly expiresAt: number | null;
  readonly userEmail: string | null;
}

const readExpiresAt = (raw: unknown): number | null => {
  const field = (raw as { expiresAt?: unknown } | null)?.expiresAt;
  return typeof field === "number" && Number.isFinite(field) ? field : null;
};

const readUserEmail = (raw: unknown): string | null => {
  const field = (raw as { userEmail?: unknown } | null)?.userEmail;
  return typeof field === "string" && field.length > 0 ? field : null;
};

const readPersisted = (): PersistedToken | null => {
  if (typeof globalThis.localStorage === "undefined") return null;
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("token" in parsed)) return null;
    const { token } = parsed as { token: unknown };
    if (typeof token !== "string") return null;
    return {
      token,
      expiresAt: readExpiresAt(parsed),
      userEmail: readUserEmail(parsed),
    };
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
  readonly userEmail: string | null;
  readonly setAccessToken: (input: { token: string; expiresIn: number; email?: string }) => void;
  readonly clearTokens: () => void;
}

const computeExpiresAt = (now: number, expiresIn: number): number => now + expiresIn * 1000;

export const useTokenStore = create<TokenState>((set) => {
  const persisted = readPersisted();
  return {
    accessToken: persisted?.token ?? null,
    expiresAt: persisted?.expiresAt ?? null,
    userEmail: persisted?.userEmail ?? null,
    setAccessToken: ({ token, expiresIn, email }) => {
      const expiresAt = computeExpiresAt(Date.now(), expiresIn);
      // Email is sticky: a refresh that doesn't carry a new email
      // identity keeps the previously-stored value so the TopBar's
      // user chip survives the silent refresh that happens on a
      // hard-reload of `/dashboard`. A LOGIN (which DOES carry the
      // email) overrides; a clearTokens() zero-fills.
      const prev = useTokenStore.getState();
      const nextEmail = email !== undefined && email.length > 0 ? email : prev.userEmail;
      writePersisted({ token, expiresAt, userEmail: nextEmail });
      set({ accessToken: token, expiresAt, userEmail: nextEmail });
    },
    clearTokens: () => {
      writePersisted(null);
      set({ accessToken: null, expiresAt: null, userEmail: null });
    },
  };
});

/** Synchronous role read for `CurrentRoleContext`'s initial render. */
export const readRoleFromStore = (): Role | null => {
  const { accessToken } = useTokenStore.getState();
  if (accessToken === null) return null;
  return decodeAccessToken(accessToken).role;
};

/** Synchronous `sub` read; mirrors `readRoleFromStore` for `userId`. */
export const readUserIdFromStore = (): string | null => {
  const { accessToken } = useTokenStore.getState();
  if (accessToken === null) return null;
  return decodeAccessToken(accessToken).userId;
};

/** Synchronous raw-token read for the apiClient's Bearer header. */
export const readAccessToken = (): string | null => useTokenStore.getState().accessToken;

/** Synchronous email read for the TopBar's user identity chip. */
export const readUserEmailFromStore = (): string | null => useTokenStore.getState().userEmail;

/** Test helper: resets the singleton store + persisted entry. Production callers
 *  use `clearTokens()` instead. */
export const _resetTokenStore = (): void => {
  useTokenStore.setState({ accessToken: null, expiresAt: null, userEmail: null });
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  }
};
