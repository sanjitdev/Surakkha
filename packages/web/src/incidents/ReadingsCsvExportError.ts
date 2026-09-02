/**
 * Tagged error for non-403 CSV export failures. `status` is
 * preserved so the toast layer can switch on it (401 → session
 * expired; 5xx → try again). The 403 path uses
 * `ReadingsCsvExportRbacDeniedError` instead.
 */
export class ReadingsCsvExportError extends Error {
  public readonly status: number;
  public constructor(status: number, message: string) {
    super(message);
    this.name = "ReadingsCsvExportError";
    this.status = status;
  }
}
