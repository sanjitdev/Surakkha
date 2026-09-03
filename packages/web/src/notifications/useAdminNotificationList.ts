/**
 * TanStack `useQuery` over `GET /api/notifications/admin/list`.
 * Filter-keyed cache; 30s polling; severity is a `readonly
 * NotificationSeverity[]` so multi-chip selections produce a
 * coherent cache key. On 403 throws `AdminNotificationsRbacDeniedError`.
 * Wire-shape validated via `AdminNotificationListEnvelopeSchema` so
 * adapter drift surfaces as a parse failure.
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

export type { AdminNotificationFilters };

export const ADMIN_NOTIFICATIONS_QUERY_KEY = (
  filters: AdminNotificationFilters,
): readonly ["admin-notifications", "list", AdminNotificationFilters] => {
  const { severity, sincePresetMs } = filters;
  const cacheKey: {
    severity?: AdminNotificationFilters["severity"];
    sincePresetMs?: number;
  } = {};
  if (severity !== undefined) cacheKey.severity = severity;
  if (sincePresetMs !== undefined) cacheKey.sincePresetMs = sincePresetMs;
  return ["admin-notifications", "list", cacheKey] as const;
};

const HTTP_FORBIDDEN = 403;
const POLL_INTERVAL_MS = 30_000;

export const resolveEffectiveSince = (
  filters: AdminNotificationFilters,
  now: Date = new Date(),
): string | undefined => {
  if (filters.sincePresetMs !== undefined) {
    return new Date(now.getTime() - filters.sincePresetMs).toISOString();
  }
  return filters.since;
};

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

export const useAdminNotificationList = (filters: AdminNotificationFilters = {}) => {
  const query = useQuery<AdminNotificationListEnvelope, AdminNotificationsRbacDeniedError>({
    queryKey: [...ADMIN_NOTIFICATIONS_QUERY_KEY(filters)],
    queryFn: async ({ signal }): Promise<AdminNotificationListEnvelope> => {
      const qs = buildAdminQueryString(filters, new Date());
      const res = await apiFetch(`/api/notifications/admin/list${qs}`, { signal });
      if (res.status === HTTP_FORBIDDEN) {
        throw new AdminNotificationsRbacDeniedError();
      }
      if (!res.ok) {
        throw new Error(`/api/notifications/admin/list failed: ${res.status}`);
      }
      const raw = (await res.json()) as unknown;
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

  const notifications: readonly AdminNotificationPayload[] = query.data?.notifications ?? [];
  return { notifications, query };
};
