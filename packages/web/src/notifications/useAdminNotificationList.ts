/**
 * `useAdminNotificationList` — Story 5.1.
 *
 * TanStack `useQuery` over `GET /api/notifications/admin/list`.
 * The cache key is `["admin-notifications", "list", filters]`
 * (filters-keyed) so toggling a chip changes the cache slot AND
 * the fetch; the polling keeps the slot warm while a chip is
 * steady.
 *
 * Mirrors the 4.10 `useNotificationBell` pattern with two
 * critical differences:
 *
 *   1. **Filter shape.** The bell's filters are `null`-vs-not
 *      (read-only or not). The admin list filters are a typed
 *      shape (`AdminNotificationFilters`) — `severity` is a
 *      `readonly NotificationSeverity[]` so 1, 2, or 3 chips
 *      produce a coherent cache key. Pre-Loop 1, the filter was
 *      a single-valued severity that silently dropped the filter
 *      when 2–3 chips were active; the wire shape is now a
 *      deduplicated array end-to-end.
 *
 *   2. **Polling cadence.** 30_000 ms (`refetchInterval`).
 *      Matches the bell (4.10) — the spec forbids adding a
 *      `notification:*` socket event; polling is the source of
 *      admin-side freshness.
 *
 * `staleTime: 0` keeps the badge current on every poll — the
 * `refetchInterval` is the source of truth, not the cache TTL.
 *
 * On 403 the hook's `queryFn` throws `AdminNotificationsRbacDeniedError`
 * (sibling of `NotificationsRbacDeniedError`). The page-level
 * `<RbacRoute>` already gates the route on `isPathAllowedForRole`,
 * so the 403 path is the defense-in-depth branch (token expiry
 * mid-session, or a future role that loses the matrix grant).
 */
import {
  type AdminNotificationFilters,
  type AdminNotificationListEnvelope,
  AdminNotificationListEnvelopeSchema,
  type AdminNotificationPayload,
} from "@surakkha/shared/notification";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { AdminNotificationsRbacDeniedError } from "./AdminNotificationsRbacDeniedError";

// Re-export the shared filter type for backwards compatibility
// with imports that previously resolved the type from this file.
// The shared `@surakkha/shared/notification` is the canonical home;
// the hook is a thin pass-through.
export type { AdminNotificationFilters };

/**
 * TanStack Query key for the admin notification list. Filter-keyed
 * so the chip row + date picker produce a fresh slot on every
 * toggle. `since` / `until` are stripped from the key (they're
 * request-scoped, not cache-scoped — recomputing `since` per poll
 * is required so the lower bound slides forward over time).
 *
 * Loop 2 review hardening: pre-Loop 2, `since` was in the queryKey
 * AND frozen in the page's `useMemo` deps at first paint. After
 * 30s the polling refetched but `since` was still the original ISO
 * string → the window slid back to the mount time, missing newer
 * rows. Fix: strip `since`/`until` from the key; the page resolves
 * them again inside `queryFn` on every fetch.
 *
 * Exported as `ADMIN_NOTIFICATIONS_QUERY_KEY` for the test rig's
 * cache-key pin (mirrors `UNREAD_NOTIFICATIONS_QUERY_KEY` in
 * 4.10's `useNotificationBell.ts:57-59`).
 */
export const ADMIN_NOTIFICATIONS_QUERY_KEY = (
  filters: AdminNotificationFilters,
): readonly ["admin-notifications", "list", AdminNotificationFilters] => {
  // Strip request-scoped fields from the cache key. `severity` and
  // `sincePresetMs` are the fields that drive cache-slot
  // invalidation — they're user-controlled UI inputs whose change
  // must trigger a fresh fetch.
  //
  // `since` / `until` are intentionally OMITTED: they're
  // request-scoped (re-derived per fetch via `resolveEffectiveSince`)
  // and recomputing them would key the cache on the wall-clock,
  // which would invalidate every 30s poll.
  const { severity, sincePresetMs } = filters;
  const cacheKey: {
    severity?: AdminNotificationFilters["severity"];
    sincePresetMs?: number;
  } = {};
  if (severity !== undefined) cacheKey.severity = severity;
  if (sincePresetMs !== undefined) cacheKey.sincePresetMs = sincePresetMs;
  return ["admin-notifications", "list", cacheKey] as const;
};

/** HTTP status code sentinel — RBAC denial. */
const HTTP_FORBIDDEN = 403;

/** 30s polling interval per the spec ("refetchInterval: 30_000"). */
const POLL_INTERVAL_MS = 30_000;

/**
 * Resolve the effective `since` for a fetch. If `sincePresetMs` is
 * set, recompute `since = now - sincePresetMs` so the lower bound
 * slides forward during 30s polling (Loop 2 hardening). Otherwise
 * use the page-provided `since` verbatim.
 *
 * Exported for the test rig.
 */
export const resolveEffectiveSince = (
  filters: AdminNotificationFilters,
  now: Date = new Date(),
): string | undefined => {
  if (filters.sincePresetMs !== undefined) {
    return new Date(now.getTime() - filters.sincePresetMs).toISOString();
  }
  return filters.since;
};

/**
 * Build the admin-list query string. The severity field is a
 * REPEATED query param — `?severity=critical&severity=warning` —
 * so the api parses it as an array (Express + Zod coerce). The
 * `since` / `until` fields are emitted once each.
 *
 * Loop 1 fix: pre-Loop 1 the page emitted `?severity=critical`
 * only; 2-chip and 3-chip selections silently dropped the
 * filter. The chip row → wire → api → Prisma path is now
 * end-to-end array-aware.
 *
 * Loop 2 fix: pass an explicit `now` parameter (default `new
 * Date()`) so tests can pin the resolved `since` deterministically
 * without `vi.useFakeTimers()`.
 *
 * Exported as `buildAdminQueryString` so the test rig can assert
 * the wire shape directly.
 */
export const buildAdminQueryString = (
  filters: AdminNotificationFilters,
  now: Date = new Date(),
): string => {
  const params = new URLSearchParams();
  if (filters.severity !== undefined) {
    for (const sev of filters.severity) {
      params.append("severity", sev);
    }
  }
  const effectiveSince = resolveEffectiveSince(filters, now);
  if (effectiveSince !== undefined) params.set("since", effectiveSince);
  if (filters.until !== undefined) params.set("until", filters.until);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
};

/**
 * `useAdminNotificationList` — TanStack `useQuery` over
 * `/api/notifications/admin/list`.
 *
 * Returns `{ notifications, query }`. The hook is the read-only
 * projection; the consumer is `<AdminNotificationsPage />`.
 *
 * Loop 1 review hardening (E1 + E5):
 *   - Pass `queryFn`'s `signal` to `apiFetch` so rapid chip toggles
 *     abort the in-flight fetch — TanStack Query cancels the prior
 *     fetch automatically when the cache key changes, but the prior
 *     request is still alive on the wire. The AbortController
 *     surface lets the runtime tear down the connection.
 *   - Parse the response body through
 *     `AdminNotificationListEnvelopeSchema` so a tampered response
 *     (or a future adapter drift that drops `acknowledgedByUserId`)
 *     fails the parse and surfaces a useful error instead of letting
 *     `undefined` propagate.
 */
export const useAdminNotificationList = (filters: AdminNotificationFilters = {}) => {
  const query = useQuery<AdminNotificationListEnvelope, AdminNotificationsRbacDeniedError>({
    queryKey: [...ADMIN_NOTIFICATIONS_QUERY_KEY(filters)],
    queryFn: async ({ signal }): Promise<AdminNotificationListEnvelope> => {
      // Loop 2 hardening: re-derive `since` on every fetch (poll
      // or user-triggered). The page passes `sincePresetMs` so the
      // window slides forward over time; passing `new Date()` here
      // means polling at t+30s slides the lower bound forward 30s.
      const qs = buildAdminQueryString(filters, new Date());
      const res = await apiFetch(`/api/notifications/admin/list${qs}`, { signal });
      if (res.status === HTTP_FORBIDDEN) {
        // Defense-in-depth — the route-level `<RbacRoute>` should
        // already short-circuit a non-Admin. This branch handles
        // the race where a token's role changes mid-session (the
        // matrix grant is re-evaluated server-side at request
        // time).
        throw new AdminNotificationsRbacDeniedError();
      }
      if (!res.ok) {
        throw new Error(`/api/notifications/admin/list failed: ${res.status}`);
      }
      const raw = (await res.json()) as unknown;
      // Strict shape check — pin the wire contract so adapter
      // drift (e.g. `acknowledgedByUserId` accidentally omitted)
      // surfaces as a parse failure rather than a silent loss of
      // the audit field. The Zod schema is the canonical wire
      // shape (see `@surakkha/shared/notification.ts:144-149`).
      const parsed = AdminNotificationListEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `/api/notifications/admin/list returned malformed envelope: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 0,
  });

  // On error (any kind — RBAC, 5xx, network), the page falls
  // back to the empty-rows state so the table doesn't mis-render.
  // The `<RbacDenied />` branch is gated on the error type
  // (`instanceof AdminNotificationsRbacDeniedError`) separately.
  const notifications: readonly AdminNotificationPayload[] = query.data?.notifications ?? [];
  return { notifications, query };
};
