/**
 * TanStack Query hooks for the `/admin/thresholds` admin tab — Story 3.7.
 *
 * Five hooks:
 *   - `useThresholds(activeOnly)`        — list rules, paginated.
 *   - `useCreateThreshold()`              — POST a new Rule at v1.
 *   - `useUpdateThreshold()`              — PATCH supersede or
 *                                          deactivate.
 *   - `useActivateThreshold()`           — PATCH /rules/:id/activate
 *                                          (idempotent).
 *
 * All mutations invalidate the `["admin", "thresholds", "rules"]`
 * query key on success so the page refetches.
 *
 * Wire shapes are parsed by Zod against `RuleListResponseSchema`,
 * `RuleRowSchema`, `RuleSupersedeResponseSchema`, etc. from
 * `@surakkha/shared/rule` (defence-in-depth against schema drift
 * between api + web).
 */
import {
  type RuleCreateRequest,
  RuleListResponseSchema,
  type RulePatchRequest,
  type RuleRow,
  RuleRowSchema,
  RuleSupersedeResponseSchema,
} from "@surakkha/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../../api/apiClient";

// Re-export the shared wire row type so the page code only imports
// from this module.
export type { RuleRow } from "@surakkha/shared";

const THRESHOLDS_RULES_KEY = ["admin", "thresholds", "rules"] as const;

/**
 * Query one page of rules. `activeOnly` defaults to `false` so the
 * page shows the full history (active + inactive versions).
 */
export const useThresholds = (activeOnly: boolean = false) =>
  useQuery({
    queryKey: [...THRESHOLDS_RULES_KEY, activeOnly] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("activeOnly", activeOnly ? "true" : "false");
      const res = await apiFetch(`/admin/thresholds/rules?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`thresholds fetch failed: ${res.status}`);
      }
      const parsed = RuleListResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("thresholds wire-shape mismatch", parsed.error);
        throw new Error("thresholds wire-shape mismatch");
      }
      return parsed.data;
    },
  });

/**
 * Create a new Rule at v1.
 */
export const useCreateThreshold = () => {
  const qc = useQueryClient();
  return useMutation<RuleRow, Error, RuleCreateRequest>({
    mutationFn: async (body) => {
      const res = await apiFetch("/admin/thresholds/rules", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`create threshold failed: ${res.status}`);
      }
      // The api returns a bare `RuleRow` (not wrapped in `{ rule }`)
      // — the schema parse below strips the optional wrapper.
      const parsed = RuleRowSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("create threshold wire-shape mismatch", parsed.error);
        throw new Error("create threshold wire-shape mismatch");
      }
      return parsed.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: THRESHOLDS_RULES_KEY });
    },
  });
};

/**
 * PATCH /rules/:id — supersede or deactivate, depending on body
 * shape. `supersede: true` returns `{ old, new }`; `activate: false`
 * returns a single row.
 */
export const useUpdateThreshold = () => {
  const qc = useQueryClient();
  return useMutation<
    | { readonly kind: "supersede"; readonly old: RuleRow; readonly next: RuleRow }
    | { readonly kind: "deactivate"; readonly row: RuleRow },
    Error,
    { readonly id: string; readonly body: RulePatchRequest }
  >({
    mutationFn: async ({ id, body }) => {
      const res = await apiFetch(`/admin/thresholds/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`update threshold failed: ${res.status}`);
      }
      // The api returns `{ old, new }` for supersede, a bare row for
      // deactivate. Branch on the body shape we sent to disambiguate.
      if ("supersede" in body && body.supersede === true) {
        const parsed = RuleSupersedeResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          console.error("supersede wire-shape mismatch", parsed.error);
          throw new Error("supersede wire-shape mismatch");
        }
        return { kind: "supersede", old: parsed.data.old, next: parsed.data.new };
      }
      const parsed = RuleRowSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("deactivate wire-shape mismatch", parsed.error);
        throw new Error("deactivate wire-shape mismatch");
      }
      return { kind: "deactivate", row: parsed.data };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: THRESHOLDS_RULES_KEY });
    },
  });
};

/**
 * PATCH /rules/:id/activate — flip isActive to true (idempotent).
 */
export const useActivateThreshold = () => {
  const qc = useQueryClient();
  return useMutation<RuleRow, Error, { readonly id: string }>({
    mutationFn: async ({ id }) => {
      const res = await apiFetch(`/admin/thresholds/rules/${id}/activate`, {
        method: "PATCH",
      });
      if (!res.ok) {
        throw new Error(`activate threshold failed: ${res.status}`);
      }
      const parsed = RuleRowSchema.safeParse(await res.json());
      if (!parsed.success) {
        console.error("activate wire-shape mismatch", parsed.error);
        throw new Error("activate wire-shape mismatch");
      }
      return parsed.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: THRESHOLDS_RULES_KEY });
    },
  });
};
