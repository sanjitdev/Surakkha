/**
 * `ReadingsCsvExportError` — tagged error for non-RBAC failures of
 * the readings CSV export. Extracted to its own module so the
 * mutation file (`useDownloadReadingsCsvMutation.ts`) stays under
 * the `max-classes-per-file` lint cap.
 *
 * `status` is preserved so callers can switch on it for toast copy
 * (401 → "session expired", 5xx → "try again"). The 403 path uses
 * a separate `ReadingsCsvExportRbacDeniedError` instead.
 */
export class ReadingsCsvExportError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ReadingsCsvExportError";
    this.status = status;
  }
}
