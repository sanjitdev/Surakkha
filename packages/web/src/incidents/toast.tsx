/**
 * `toast.ts` — Story 4.5, Epic-6 sweep.
 *
 * Shared inline-toast primitive for every Surakkha page surface.
 * Exposes:
 *
 *   - `useToasts()` — page-local toast queue with auto-expiry TTL.
 *   - `<ToastRegion />` — renders the current queue as a polite
 *     `<ul>`, with optional per-page testid prefix so multiple
 *     pages can mount their own region without colliding on
 *     `data-testid="toast-region"`.
 *
 * Why shared (not a library):
 *
 *   - Surakkha has zero toast dependencies today. Pulling in a
 *     third-party library for a single 4-second transient would be
 *     premature.
 *   - Four pages (`IncidentDetailPage`, `ThresholdsPage`,
 *     `ThresholdsPopulatedView`, `SimulatorPage`) each had their own
 *     inline implementation, all with the same green/red palette and
 *     same 4-second TTL. The Epic-6 sweep consolidates them here so
 *     the visual language stays in lock-step.
 *
 * Design notes:
 *
 *   - `useToasts()` owns the toast list state + a `Set<Timeout>`
 *     ref-tracked timer pool so unmount cleanly cancels pending `setTimeout`
 *     callbacks (no late `setState` on an unmounted tree).
 *   - `<ToastRegion />` is mounted at the page root by every
 *     consumer. It renders an `aria-live="polite"` `<ul>` so screen
 *     readers announce the toast.
 *   - The `ToastEntry.id` counter is page-scoped (a single
 *     `useRef<number>(0)`); toasts do NOT collide across mounts because
 *     the hook is page-local.
 *   - TTL is 4_000 ms.
 *
 * Tone palette — routed through the design tokens in
 * `tailwind.config.ts` so the toast surface is in lock-step with the
 * rest of the app's severity language:
 *
 *   - success → `bg-severity-healthy-bg` / `text-severity-healthy-text` /
 *     `border-severity-healthy-text`
 *   - error   → `bg-severity-critical-bg` / `text-severity-critical-text` /
 *     `border-severity-critical-text`
 *
 *   These classes are enumerated LITERALLY in the className strings
 *   below (not interpolated) so Tailwind's content scanner picks them
 *   up at build time. See DESIGN.md §Colors.
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
  // does not fire on a torn-down tree.
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
 * `TOAST_TTL_MS` — exported so tests can pin the exact duration.
 */
export { TOAST_TTL_MS };

/**
 * Tone → Tailwind class map. The class strings are written as
 * LITERAL concatenations (not template-interpolated) so Tailwind's
 * content scanner finds them at build time. Adding a new tone
 * requires extending both the `ToastTone` union and the two records
 * below.
 */
const TOAST_CLASSES: Record<ToastTone, string> = {
  // bg-severity-healthy-bg border-severity-healthy-text text-severity-healthy-text
  success: "bg-severity-healthy-bg border-severity-healthy-text text-severity-healthy-text",
  // bg-severity-critical-bg border-severity-critical-text text-severity-critical-text
  error: "bg-severity-critical-bg border-severity-critical-text text-severity-critical-text",
};

interface ToastRegionProps {
  readonly toasts: readonly ToastEntry[];
  /**
   * Prefix prepended to every emitted `data-testid` so multiple
   * pages can mount their own region without colliding on
   * `data-testid="toast-region"`. Defaults to `"toast"`.
   *
   * The full prefix (including any `toast-` infix) is supplied by
   * the caller, so consumers can opt into either shape:
   *
   *   testIdPrefix="toast"               → `toast-region`, `toast-{tone}-{id}`
   *   testIdPrefix="simulator-toast"     → `simulator-toast-region`, `simulator-toast-{tone}`
   *   testIdPrefix="thresholds-toast"    → `thresholds-toast-region`, `thresholds-toast-{tone}`
   */
  readonly testIdPrefix?: string;
  /**
   * Whether the item testid includes the toast's numeric id suffix.
   * Defaults to `true` — the canonical shape is
   * `toast-{tone}-{id}` (used by `IncidentDetailPage`). Set to
   * `false` for the per-page `simulator-toast-{tone}` /
   * `thresholds-toast-{tone}` convention.
   */
  readonly isId?: boolean;
}

/**
 * `<ToastRegion />` — renders the current toast queue.
 *
 * Mounted at the page root by every consumer. The testid prefix is
 * configurable so two pages can both render a region without
 * colliding on `data-testid="toast-region"`.
 *
 * Accessibility:
 *   - The region itself announces politely (success / info tones).
 *   - Each error-tone `<li>` upgrades to `role="alert"` +
 *     `aria-live="assertive"` so failures are announced immediately
 *     instead of waiting for the next idle — failures are the
 *     class of message the operator MUST see right now.
 */
export const ToastRegion = ({ toasts, testIdPrefix = "toast", isId = true }: ToastRegionProps) => (
  <ul data-testid={`${testIdPrefix}-region`} aria-live="polite" className="flex flex-col gap-2">
    {toasts.map((t) => (
      <li
        key={t.id}
        data-testid={isId ? `${testIdPrefix}-${t.tone}-${t.id}` : `${testIdPrefix}-${t.tone}`}
        data-tone={t.tone}
        // Error toasts are the "operator MUST see this now" class —
        // upgrade to role="alert" + aria-live="assertive" so screen
        // readers announce immediately. Success / info stay polite.
        {...(t.tone === "error"
          ? { role: "alert", "aria-live": "assertive" }
          : { "aria-live": "polite" })}
        className={`rounded-input border px-4 py-2 text-md ${TOAST_CLASSES[t.tone]}`}
      >
        {t.message}
      </li>
    ))}
  </ul>
);
