/**
 * TanStack `useQuery` over `GET /api/audit/list`. Filter-keyed
 * cache slot; `since` / `until` are wire-only (re-derived per fetch)
 * so a wall-clock-tied cache key would churn every 30s poll.
 * `staleTime: 0` keeps each poll authoritative.
 *
 * `queryFn` parses through `AuditLogListEnvelopeSchema` so a tampered
 * response (or future adapter drift) fails the parse instead of
 * letting `undefined` propagate.
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

export interface AuditLogHookFilters extends AuditLogFilters {
  readonly preset?: string;
}

const HTTP_FORBIDDEN = 403;
const POLL_INTERVAL_MS = 30_000;

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;

/** `preset → ms` lookup. Keys MUST match the page's `DateRangePreset`. */
const PRESET_WINDOW_MS: Record<string, number> = {
  "24h": HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  "7d": DAYS_PER_WEEK * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  "30d": DAYS_PER_MONTH * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
};

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

const presetToWindowMs = (preset: string | undefined): number | undefined =>
  preset !== undefined ? PRESET_WINDOW_MS[preset] : undefined;

const resolveSince = (filters: AuditLogHookFilters, now: Date): string | undefined => {
  if (filters.since !== undefined) return filters.since;
  const ms = presetToWindowMs(filters.preset);
  return ms !== undefined ? new Date(now.getTime() - ms).toISOString() : undefined;
};

const appendFilterParams = (
  params: URLSearchParams,
  filters: AuditLogHookFilters,
  now: Date,
): void => {
  if (filters.actorIds !== undefined) {
    // Repeated `?actorIds=a&actorIds=b` — Express + Zod coerce to array;
    // the server de-duplicates.
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

export const useAuditLogList = (filters: AuditLogHookFilters = {}) => {
  const query = useQuery<AuditLogListEnvelope, AdminAuditLogRbacDeniedError>({
    queryKey: [...AUDIT_LOG_QUERY_KEY(filters)],
    queryFn: async ({ signal }): Promise<AuditLogListEnvelope> => {
      const qs = buildAuditLogQueryString(filters);
      const res = await apiFetch(`/api/audit/list${qs}`, { signal });
      if (res.status === HTTP_FORBIDDEN) {
        throw new AdminAuditLogRbacDeniedError();
      }
      if (!res.ok) {
        throw new Error(`/api/audit/list failed: ${res.status}`);
      }
      const raw = (await res.json()) as unknown;
      const parsed = AuditLogListEnvelopeSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`/api/audit/list returned malformed envelope: ${parsed.error.message}`);
      }
      return parsed.data;
    },
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: 0,
  });

  const entries: readonly AuditLogEntry[] = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const truncated = query.data?.truncated ?? false;
  return { entries, total, truncated, query };
};
