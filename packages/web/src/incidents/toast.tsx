/**
 * `toast.ts` — shared inline-toast primitive for every Surakkha
 * page surface. `useToasts()` owns the page-local queue +
 * auto-expiry TTL; `<ToastRegion />` renders it. TTL is 4s;
 * error-tone `<li>`s upgrade to `role="alert"` for screen readers.
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
 * `pushToast` is referentially stable across renders.
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

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return { toasts, pushToast };
};

export { TOAST_TTL_MS };

/**
 * Tone → Tailwind class map. Class strings are literal (not
 * template-interpolated) so the content scanner finds them at build time.
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
   * Prefix prepended to every emitted `data-testid`. Defaults to
   * `"toast"`; consumers pass a page-scoped value when two regions
   * would otherwise collide on `data-testid="toast-region"`.
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
