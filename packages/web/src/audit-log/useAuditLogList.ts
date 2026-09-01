/**
 * `useAuditLogList` — Story 5.3.
 *
 * TanStack `useQuery` over `GET /api/audit/list`. The cache key
 * is `["audit-log", "list", filters]` (filters-keyed) so toggling
 * a chip changes the cache slot AND the fetch; the polling keeps
 * the slot warm while a chip is steady.
 *
 * Mirrors the 5.1 `useAdminNotificationList` pattern with the
 * filter shape swapped to the audit-log vocabulary
 * (`actorIds`, `event`, `resource`, date-range). Polling cadence
 * is 30_000 ms (`refetchInterval`) — matches the Story 5.1 admin
 * notifications + 4.10 bell + 4.2 incident surfaces. The spec
 * forbids adding a new socket event; polling is the source of
 * admin-side freshness.
 *
 * `staleTime: 0` keeps the row current on every poll — the
 * `refetchInterval` is the source of truth, not the cache TTL.
 *
 * On 403 the hook's `queryFn` throws `AdminAuditLogRbacDeniedError`
 * (sibling of `AdminNotificationsRbacDeniedError`). The page-
 * level `<RbacRoute>` already gates the route on
 * `isPathAllowedForRole`, so the 403 path is the defense-in-depth
 * branch (token expiry mid-session, or a future role that loses
 * the matrix grant).
 */
import {
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditLogListEnvelope,
  AuditLogListEnvelopeSchema,
} from "@surakkha/shared/audit";
import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { AdminAuditLogRbacDeniedError } from "./AdminAuditLogRbacDeniedError";

/**
 * Web-side filter shape — the shared `AuditLogFilters` plus
 * `preset` so the cache key can refetch on date-range toggle.
 * The shared contract omits `preset` (it's a UI concept, not a
 * wire concept); `preset` is forward-compat for that boundary.
 *
 * `AuditLogFilters` itself is imported from
 * `@surakkha/shared/audit` (the canonical home); consumers
 * that need it should import it from there directly.
 */
export interface AuditLogHookFilters extends AuditLogFilters {
  readonly preset?: string;
}

/** HTTP status code sentinel — RBAC denial. */
const HTTP_FORBIDDEN = 403;

/** 30s polling interval per the spec ("refetchInterval: 30_000"). */
const POLL_INTERVAL_MS = 30_000;

/** Milliseconds in one second — used by the preset-window lookup. */
const MS_PER_SECOND = 1000;
/** Seconds in one minute — used by the preset-window lookup. */
const SECONDS_PER_MINUTE = 60;
/** Minutes in one hour — used by the preset-window lookup. */
const MINUTES_PER_HOUR = 60;
/** Hours in one day — used by the preset-window lookup. */
const HOURS_PER_DAY = 24;
/** Days in a week — used by the preset-window lookup. */
const DAYS_PER_WEEK = 7;
/** Days in 30 days — used by the preset-window lookup. */
const DAYS_PER_MONTH = 30;

/** `presets → ms` lookup. Keys MUST match the page's `DateRangePreset`. */
const PRESET_WINDOW_MS: Record<string, number> = {
  "24h": HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  "7d": DAYS_PER_WEEK * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  "30d": DAYS_PER_MONTH * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
};

/**
 * TanStack Query key for the audit log list. Filter-keyed so
 * the chip row + event input + date picker produce a fresh slot
 * on every toggle. `actorIds` + `event` + `resource` + `preset`
 * are the fields that drive cache-slot invalidation. `preset`
 * is the date-range knob (`24h` / `7d` / `30d` / `custom`); a
 * preset change must refetch even though the wall-clock-derived
 * `since` / `until` change with it.
 *
 * `since` / `until` are intentionally OMITTED: they're request-
 * scoped (re-derived per fetch via `buildAuditLogQueryString`)
 * and recomputing them would key the cache on the wall-clock,
 * which would invalidate every 30s poll.
 *
 * Exported as `AUDIT_LOG_QUERY_KEY` for the test rig's cache-key
 * pin (mirrors `ADMIN_NOTIFICATIONS_QUERY_KEY` in 5.1).
 */
export const AUDIT_LOG_QUERY_KEY = (
  filters: AuditLogHookFilters,
): readonly ["audit-log", "list", AuditLogHookFilters] => {
  const { actorIds, event, resource, preset } = filters;
  const cacheKey: {
    actorIds?: AuditLogFilters["actorIds"];
    event?: AuditLogFilters["event"];
    resource?: AuditLogFilters["resource"];
    preset?: string;
  } = {};
  if (actorIds !== undefined) cacheKey.actorIds = actorIds;
  if (event !== undefined) cacheKey.event = event;
  if (resource !== undefined) cacheKey.resource = resource;
  if (preset !== undefined) cacheKey.preset = preset;
  return ["audit-log", "list", cacheKey] as const;
};

/**
 * Resolve the date-range preset to a window length in milliseconds.
 * Mirrors the page's `sincePresetMsForPreset` so the hook emits
 * the same `since` for the same preset. `custom` / unknown
 * resolve to `undefined` (no auto-fill — the wire params come
 * from explicit `since` / `until`).
 */
const presetToWindowMs = (preset: string | undefined): number | undefined =>
  preset !== undefined ? PRESET_WINDOW_MS[preset] : undefined;

/**
 * Build the audit-log query string. Mirrors `buildAdminQueryString`
 * in `useAdminNotificationList.ts:136-151` with the param names
 * swapped to the audit-log vocabulary:
 *
 *   - `actorIds` is REPEATED — `?actorIds=a&actorIds=b` — so the
 *     api parses it as an array (Express + Zod coerce). The
 *     server de-duplicates.
 *   - `event` is a single free-text value (the api applies
 *     `contains` + `insensitive`).
 *   - `resource` is a single enum chip.
 *   - `since` / `until` are emitted once each. When the page
 *     passes `preset` (`24h` / `7d` / `30d`), the hook re-derives
 *     `since = now - windowMs` per fetch so the lower bound
 *     slides forward during 30s polling (per the page comment).
 *     An explicit `since` on the filter overrides the preset
 *     derivation (forward-compat for the `custom` input wire).
 *
 * Exported as `buildAuditLogQueryString` so the test rig can
 * assert the wire shape directly.
 */
/**
 * Resolve the wire-level `since` from the filter (explicit) or
 * the preset (derived). Slides forward per fetch so polling emits
 * a fresh lower bound.
 */
const resolveSince = (filters: AuditLogHookFilters, now: Date): string | undefined => {
  if (filters.since !== undefined) return filters.since;
  const ms = presetToWindowMs(filters.preset);
  return ms !== undefined ? new Date(now.getTime() - ms).toISOString() : undefined;
};

/**
 * Append the filter values to a `URLSearchParams` accumulator.
 * Extracted from `buildAuditLogQueryString` so the closure stays
 * under the `complexity: 10` ESLint ceiling.
 */
const appendFilterParams = (
  params: URLSearchParams,
  filters: AuditLogHookFilters,
  now: Date,
): void => {
  if (filters.actorIds !== undefined) {
    for (const id of filters.actorIds) {
      params.append("actorIds", id);
    }
  }
  if (filters.event !== undefined && filters.event.length > 0) {
    params.set("event", filters.event);
  }
  if (filters.resource !== undefined && filters.resource.length > 0) {
    params.set("resource", filters.resource);
  }
  const since = resolveSince(filters, now);
  if (since !== undefined) params.set("since", since);
  if (filters.until !== undefined) params.set("until", filters.until);
};

export const buildAuditLogQueryString = (
  filters: AuditLogHookFilters,
  now: Date = new Date(),
): string => {
  const params = new URLSearchParams();
  appendFilterParams(params, filters, now);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
};

/**
 * `useAuditLogList` — TanStack `useQuery` over `/api/audit/list`.
 *
 * Returns `{ entries, total, truncated, query }`. The hook is
 * the read-only projection; the consumer is `<AuditLogPage />`.
 *
 * Loop-1 fix equivalent (carried over from 5.1): pass
 * `queryFn`'s `signal` to `apiFetch` so rapid chip toggles abort
 * the in-flight fetch. Parse the response body through
 * `AuditLogListEnvelopeSchema` so a tampered response (or a
 * future adapter drift) fails the parse and surfaces a useful
 * error instead of letting `undefined` propagate.
 */
export const useAuditLogList = (filters: AuditLogHookFilters = {}) => {
  const query = useQuery<AuditLogListEnvelope, AdminAuditLogRbacDeniedError>({
    queryKey: [...AUDIT_LOG_QUERY_KEY(filters)],
    queryFn: async ({ signal }): Promise<AuditLogListEnvelope> => {
      const qs = buildAuditLogQueryString(filters);
      const res = await apiFetch(`/api/audit/list${qs}`, { signal });
      if (res.status === HTTP_FORBIDDEN) {
        // Defense-in-depth — the route-level `<RbacRoute>` should
        // already short-circuit a non-Admin. This branch handles
        // the race where a token's role changes mid-session.
        throw new AdminAuditLogRbacDeniedError();
      }
      if (!res.ok) {
        throw new Error(`/api/audit/list failed: ${res.status}`);
      }
      const raw = (await res.json()) as unknown;
      // Strict shape check — pin the wire contract so adapter
      // drift surfaces as a parse failure rather than a silent
      // loss of audit detail. The Zod schema is the canonical
      // wire shape (see `@surakkha/shared/audit.ts`).
      const parsed = AuditLogListEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`/api/audit/list returned malformed envelope: ${parsed.error.message}`);
      }
      return parsed.data;
    },
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 0,
  });

  // On error (any kind — RBAC, 5xx, network), the page falls
  // back to the empty-rows state so the table doesn't mis-render.
  // The `<RbacDenied />` branch is gated on the error type
  // (`instanceof AdminAuditLogRbacDeniedError`) separately.
  const entries: readonly AuditLogEntry[] = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const truncated = query.data?.truncated ?? false;
  return { entries, total, truncated, query };
};
