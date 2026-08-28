/**
 * `toast.ts` — Story 4.5.
 *
 * Tiny inline toast surface for the Incident detail page. Mirrors the
 * pattern that already lives in
 * `packages/web/src/admin/thresholds/ThresholdsPage.tsx:56-69` and
 * `ThresholdsPopulatedView.tsx:18-23`: a `useToasts()` hook that
 * exposes a `pushToast(tone, message)` imperative API, paired with a
 * `<ToastRegion />` renderer that walks the live toast list. No
 * external toast library is introduced — Stories 4.6 / 4.7 / 4.11
 * each consume this same primitive from the detail page; extracting
 * to a shared `<ToastRegion />` across all pages is a future Epic-6
 * sweep.
 *
 * Why inline (not a library):
 *
 *   - The codebase has zero toast dependencies today. Pulling in a
 *     third-party library for a single 4-second transient would be
 *     premature.
 *   - ThresholdsPage already owns an inline pattern; mirroring it
 *     keeps the operator UX consistent (same green/red palette, same
 *     4-second TTL).
 *
 * Design notes:
 *
 *   - `useToasts()` owns the toast list state + a `Set<Timeout>`
 *     ref-tracked timer pool so unmount cleanly cancels pending `setTimeout`
 *     callbacks (no late `setState` on an unmounted tree).
 *   - `<ToastRegion />` is mounted at the page root by
 *     `IncidentDetailPage`. It renders an `aria-live="polite"` `<ul>`
 *     mirroring the Thresholds convention.
 *   - The `ToastEntry.id` counter is page-scoped (a single
 *     `useRef<number>(0)`); toasts do NOT collide across mounts because
 *     the hook is page-local.
 *   - TTL is 4_000 ms — matches `ThresholdsPage`'s `TOAST_TTL_MS`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_TTL_MS = 4_000;

export type ToastTone = "success" | "error";

export interface ToastEntry {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

interface UseToastsResult {
  readonly toasts: readonly ToastEntry[];
  readonly pushToast: (tone: ToastTone, message: string) => void;
}

/**
 * `useToasts()` — page-local toast queue with auto-expiry TTL.
 *
 * Returns the live toast list (consumed by `<ToastRegion />`) plus a
 * stable `pushToast(tone, message)` callback. Each push schedules a
 * `setTimeout` to drop the toast after `TOAST_TTL_MS`; the timer is
 * tracked in a `useRef` so unmount cancels every pending timer in one
 * pass.
 *
 * The hook's contract:
 *   - `pushToast` is referentially stable across renders (wrapped in
 *     `useCallback` with no deps) so consumers can safely include it
 *     in a `useEffect` dep array without re-firing on every render.
 *   - `toasts` updates synchronously after `pushToast` returns, then
 *     is filtered after the TTL elapses. The two states are visibly
 *     distinct in tests (the post-TTL render no longer contains the
 *     dropped toast id).
 */
export const useToasts = (): UseToastsResult => {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const pushToast = useCallback((tone: ToastTone, message: string): void => {
    const id = nextIdRef.current + 1;
    nextIdRef.current = id;
    setToasts((cur) => [...cur, { id, tone, message }]);
    const dropExpired = (cur: readonly ToastEntry[]): readonly ToastEntry[] =>
      cur.filter((t) => t.id !== id);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setToasts(dropExpired);
    }, TOAST_TTL_MS);
    timersRef.current.add(timer);
  }, []);

  // Cancel every tracked timer on unmount so a late TTL `setState`
  // does not fire on a torn-down tree. Mirrors ThresholdsPage:73-79.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return { toasts, pushToast };
};

/**
 * `TOAST_TTL_MS` — exported so tests can pin the exact duration that
 * the ThresholdsPage pattern uses. Keeps the two toast surfaces in
 * sync.
 */
export { TOAST_TTL_MS };

/**
 * `<ToastRegion />` — renders the current toast queue.
 *
 * Mounted by `IncidentDetailPage` at the page root. Mirrors the
 * ThresholdsPage markup: `aria-live="polite"` `<ul>` with one
 * `<li>` per toast. The `data-testid="incident-detail-toast-region"`
 * is the seam for the Acknowledge-flow test rig.
 *
 * Tone palette — re-uses the ThresholdsPage colours so the operator
 * gets the same green / red visual language for "success" /
 * "error" across the app:
 *   - success: pale green (`#E8F6EE`) bg, deep-green (`#0F6B3A`) text
 *   - error:   pale red   (`#FEE2E2`) bg, deep-red   (`#7F1D1D`) text
 */
export const ToastRegion = ({ toasts }: { readonly toasts: readonly ToastEntry[] }) => {
  const TOAST_BG: Record<ToastTone, string> = {
    success: "#E8F6EE",
    error: "#FEE2E2",
  };
  const TOAST_TEXT: Record<ToastTone, string> = {
    success: "#0F6B3A",
    error: "#7F1D1D",
  };

  return (
    <ul
      data-testid="incident-detail-toast-region"
      aria-live="polite"
      className="flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <li
          key={t.id}
          data-testid={`incident-detail-toast-${t.tone}`}
          data-tone={t.tone}
          className="rounded-input border px-4 py-2 text-md"
          style={{
            backgroundColor: TOAST_BG[t.tone],
            borderColor: TOAST_TEXT[t.tone],
            color: TOAST_TEXT[t.tone],
          }}
        >
          {t.message}
        </li>
      ))}
    </ul>
  );
};
