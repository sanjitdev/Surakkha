/**
 * `tokenStore` — single source of truth for the SPA's access token.
 * Persisted to `localStorage` so a hard page reload recovers the session
 * without bouncing through /login. The refresh token lives only in an
 * httpOnly cookie; we never see it from JS.
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

/** Test helper: resets the singleton store + persisted entry. Production callers
 *  use `clearTokens()` instead. */
export const _resetTokenStore = (): void => {
  useTokenStore.setState({ accessToken: null, expiresAt: null });
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.removeItem(STORAGE_KEY);
  }
};
