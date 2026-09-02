/**
 * TanStack `useMutation` over
 * `GET /api/devices/:deviceId/readings.csv`. Wraps `apiFetch`
 * (handles Bearer auth + 401 refresh + offline). 403 throws a
 * tagged `ReadingsCsvExportRbacDeniedError`; other failures
 * throw `ReadingsCsvExportError` with the status preserved.
 * No `Idempotency-Key` is injected (GET is wire-idempotent).
 */
import { useMutation } from "@tanstack/react-query";

import { apiFetch } from "../api/apiClient";

import { ReadingsCsvExportError } from "./ReadingsCsvExportError";

const HTTP_FORBIDDEN = 403;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NETWORK_THROW = 0;

const FALLBACK_FILENAME = "readings-export.csv";

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

const filenameFromContentDisposition = (raw: string | null): string | null => {
  if (raw === null) return null;
  const match = /filename="([^"]+)"/.exec(raw);
  return match === null ? null : (match[1] ?? null);
};

const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
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
