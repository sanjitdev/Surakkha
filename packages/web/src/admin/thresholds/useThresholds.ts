/**
 * TanStack Query hooks for the `/admin/thresholds` admin tab. All
 * mutations invalidate the `["admin", "thresholds", "rules"]` key on
 * success; wire shapes are Zod-parsed for defence-in-depth against
 * api/web schema drift.
 */
import {
  type RuleCreateRequest,
  RuleListResponseSchema,
  type RulePatchRequest,
  type RuleRow,
  RuleRowSchema,
  RuleSupersedeResponseSchema,
} from "@surakkha/shared";
import {
  type SafeParseReturnType,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "../../api/apiClient";

export type { RuleRow } from "@surakkha/shared";

const THRESHOLDS_RULES_KEY = ["admin", "thresholds", "rules"] as const;

const assertWireShape = <T>(parsed: SafeParseReturnType<unknown, T>, label: string): T => {
  if (!parsed.success) {
    console.error(`${label} wire-shape mismatch`, parsed.error);
    throw new Error(`${label} wire-shape mismatch`);
  }
  return parsed.data;
};

/**
 * Build a human-readable error message from a non-`ok` response. The
 * api returns `{ error: "validation_error", issues: [...] }` on Zod
 * parse failures (see `thresholdsRouter.sendValidationError`); we
 * surface the issues' `.path` + `.message` so an operator can see
 * WHICH field failed instead of a bare "failed: 400" toast. For all
 * other non-2xx responses we fall back to `status` + the body's
 * `error` string (or "unknown_error" if absent / non-JSON).
 */
const isValidationError = (
  parsed: unknown,
): parsed is { issues: ReadonlyArray<{ path?: unknown; message?: unknown }> } =>
  parsed !== null &&
  typeof parsed === "object" &&
  "error" in parsed &&
  (parsed as { error: unknown }).error === "validation_error" &&
  "issues" in parsed &&
  Array.isArray((parsed as { issues: unknown }).issues);

const summarizeIssues = (issues: ReadonlyArray<{ path?: unknown; message?: unknown }>): string =>
  issues
    .map((i) => {
      const path = Array.isArray(i.path) ? i.path.join(".") : "";
      return path === "" ? `${i.message ?? "invalid"}` : `${path}: ${i.message ?? "invalid"}`;
    })
    .join("; ");

const errorCodeFromBody = (parsed: unknown): string =>
  parsed !== null && typeof parsed === "object" && "error" in parsed
    ? String((parsed as { error: unknown }).error)
    : "unknown_error";

const parseApiError = async (res: Response, label: string): Promise<Error> => {
  let bodyText: string;
  let parsed: unknown;
  try {
    bodyText = await res.text();
    parsed = JSON.parse(bodyText);
  } catch {
    return new Error(`${label} failed: ${res.status} (no body)`);
  }
  if (isValidationError(parsed)) {
    const summary = summarizeIssues(parsed.issues);
    return new Error(`${label} failed: ${res.status} — ${summary || "validation_error"}`);
  }
  const { status } = res;
  const errStr = errorCodeFromBody(parsed);
  return new Error(`${label} failed: ${status} — ${errStr}`);
};

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
        throw await parseApiError(res, "thresholds fetch");
      }
      const parsed = RuleListResponseSchema.safeParse(await res.json());
      return assertWireShape(parsed, "thresholds");
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
        throw await parseApiError(res, "create threshold");
      }
      const parsed = RuleRowSchema.safeParse(await res.json());
      return assertWireShape(parsed, "create threshold");
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
        throw await parseApiError(res, "update threshold");
      }
      // The api returns `{ old, new }` for supersede, a bare row for
      // deactivate. Branch on the body shape we sent to disambiguate.
      if ("supersede" in body && body.supersede === true) {
        const parsed = RuleSupersedeResponseSchema.safeParse(await res.json());
        const data = assertWireShape(parsed, "supersede");
        return { kind: "supersede", old: data.old, next: data.new };
      }
      const parsed = RuleRowSchema.safeParse(await res.json());
      const data = assertWireShape(parsed, "deactivate");
      return { kind: "deactivate", row: data };
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
        throw await parseApiError(res, "activate threshold");
      }
      const parsed = RuleRowSchema.safeParse(await res.json());
      return assertWireShape(parsed, "activate threshold");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: THRESHOLDS_RULES_KEY });
    },
  });
};
