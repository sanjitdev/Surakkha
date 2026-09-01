/**
 * `useDownloadReadingsCsvMutation` — Story 5.2.
 *
 * TanStack `useMutation` over
 * `GET /api/devices/:deviceId/readings.csv`. Wraps `apiFetch` from
 * `../api/apiClient` (handles Bearer auth + 401 refresh + offline
 * state). On success: reads `res.blob()`, creates an object URL,
 * clicks a hidden `<a download>`, then revokes the object URL.
 *
 * Mirrors the 4.10 RBAC-error pattern (NotificationsRbacDeniedError):
 * a 403 response throws a tagged `ReadingsCsvExportRbacDeniedError`
 * so the page can route the toast to the right lane without
 * parsing the error string. Other failures throw a tagged
 * `ReadingsCsvExportError` with the status preserved.
 *
 * The mutation does NOT touch any TanStack Query cache — the
 * download is fire-and-forget; there is no cache key the export
 * could invalidate.
 *
 * The `Content-Disposition` header carries the filename the api
 * chose (`device-{deviceId}-readings-{since}.csv`) and we forward
 * that as the anchor's `download` attribute so the operator's
 * browser saves under the expected name. If the header is missing
 * (api down or proxy stripped it), we fall back to a default name.
 *
 * Why no idempotency key: GET requests are inherently
 * idempotent at the wire layer, and the api's export endpoint is
 * a one-shot read. The 4.5/4.6/4.7 mutations need
 * `Idempotency-Key` because they mutate server state; this
 * mutation does not.
 */
import { useMutation } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { ReadingsCsvExportError } from "./ReadingsCsvExportError";

const HTTP_FORBIDDEN = 403;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NETWORK_THROW = 0;

const FALLBACK_FILENAME = "readings-export.csv";

/**
 * Tagged RBAC-denial error. The page routes 403 to the
 * `RbacDenied` toast copy so the operator understands the gate is
 * permanent (their role can never export) — separate from a
 * retryable 5xx. Mirrors `NotificationsRbacDeniedError` from
 * Story 4.10.
 */
export class ReadingsCsvExportRbacDeniedError extends Error {
  public constructor(message = "Not authorized to export readings") {
    super(message);
    this.name = "ReadingsCsvExportRbacDeniedError";
  }
}

const classifyError = async (res: Response): Promise<Error> => {
  if (res.status === HTTP_FORBIDDEN) {
    return new ReadingsCsvExportRbacDeniedError();
  }
  if (res.status === HTTP_UNAUTHORIZED) {
    return new ReadingsCsvExportError(res.status, "Session expired — please sign in again");
  }
  return new ReadingsCsvExportError(res.status, "Failed to export readings. Try again.");
};

/**
 * Extract the filename from `Content-Disposition`. Mirrors the
 * `attachment; filename="X"` shape the api emits. Returns null if
 * the header is absent or malformed.
 */
const filenameFromContentDisposition = (raw: string | null): string | null => {
  if (raw === null) return null;
  const match = /filename="([^"]+)"/.exec(raw);
  return match === null ? null : (match[1] ?? null);
};

/**
 * Trigger a browser download for `blob` under `filename`. The
 * anchor is created and removed in the same synchronous tick so
 * the DOM never carries the element past the click event. Object
 * URLs are revoked after `click()` to free memory.
 */
const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Some browsers require the anchor to be in the DOM before the
  // synthetic click is honored.
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

interface DownloadCsvVariables {
  readonly deviceId: string;
}

interface DownloadCsvResult {
  readonly filename: string;
  readonly rowCount: number | null;
}

/**
 * `useDownloadReadingsCsvMutation` — TanStack `useMutation` for
 * the "Export CSV (30d)" button on the incident detail page.
 *
 * Returns `{ mutate, isPending, error, ... }`. The page wires
 * `mutate({ deviceId })` on button click and consumes
 * `isPending` for the loading-state disabled affordance.
 *
 * Note: the mutation does NOT parse the CSV body to count rows —
 * the wire is a `Transfer-Encoding: chunked` stream with no
 * trailing row-count envelope, and parsing the CSV client-side
 * would defeat the streaming win. We surface a best-effort
 * `rowCount: null` so the success toast can stay generic; the
 * spec's "Downloaded {rowCount} rows" copy uses the `Content-
 * Length` header when available, falling back to "rows" (no
 * count) otherwise.
 */
export const useDownloadReadingsCsvMutation = () =>
  useMutation<DownloadCsvResult, Error, DownloadCsvVariables>({
    mutationFn: async ({ deviceId }): Promise<DownloadCsvResult> => {
      try {
        const res = await apiFetch(`/api/devices/${deviceId}/readings.csv`);
        if (!res.ok) {
          throw await classifyError(res);
        }
        const blob = await res.blob();
        const filename =
          filenameFromContentDisposition(res.headers.get("content-disposition")) ??
          FALLBACK_FILENAME;
        triggerDownload(blob, filename);
        // We do not count rows on the client — the spec's success
        // toast uses "Downloaded readings" copy without a row count.
        return { filename, rowCount: null };
      } catch (err) {
        if (
          err instanceof ReadingsCsvExportRbacDeniedError ||
          err instanceof ReadingsCsvExportError
        ) {
          throw err;
        }
        // Network throw / abort / DNS failure — synthesize a
        // status-0 Error so the page's `instanceof` switch surfaces
        // a generic retryable toast.
        throw await classifyError(new Response(null, { status: HTTP_NETWORK_THROW }));
      }
    },
  });
