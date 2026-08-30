/**
 * `detectMimeFromURL` — Story 4.13.
 *
 * Pure helper: takes an http(s) URL string, returns the MIME type
 * inferred from the URL's extension. Falls back to
 * `application/octet-stream` for unknown extensions.
 *
 * The whitelist is deliberately small (the common image / doc / archive
 * types operators will paste). Unknown extensions map to the
 * generic-stream MIME so the upload still succeeds (the caller can
 * override with an explicit `mime` field — see spec §MIME_OVERRIDE).
 *
 * SECURITY: this is a UX hint, NOT a security boundary. The server
 * trusts the client's `mime` field after the explicit regex check
 * (see attachmentRouter.ts). A malicious client could send
 * `mime: "text/html"` and render arbitrary HTML if the web side
 * displayed it unsafely — but the detail page renders the mime as a
 * TEXT badge, never as a script tag or `<object>`. Defence-in-depth
 * lives in the UI's text-only rendering.
 */

const EXT_TO_MIME: Record<string, string> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  // Archives
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  // Audio/video (rare for incident evidence but supported)
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export const FALLBACK_MIME = "application/octet-stream";

/**
 * Infer the MIME type from a URL's extension. The URL must already
 * have been validated by `validateHttpUrl` (the caller passes
 * `url.pathname`); this helper doesn't re-validate.
 *
 * Returns `FALLBACK_MIME` ("application/octet-stream") when:
 *   - The pathname has no extension (e.g., `https://example.com/api/v1/x`)
 *   - The extension is not in the whitelist (e.g., `https://x.com/y.zzz`)
 *   - The extension is uppercase or has trailing whitespace (normalised
 *     before lookup)
 */
export const detectMimeFromURL = (urlString: string): string => {
  let pathname: string;
  try {
    const { pathname: parsedPath } = new URL(urlString);
    pathname = parsedPath;
  } catch {
    return FALLBACK_MIME;
  }
  // Strip query string / hash already handled by URL parsing.
  const lastDot = pathname.lastIndexOf(".");
  const lastSlash = pathname.lastIndexOf("/");
  // No extension if the last dot is before the last slash (or absent).
  if (lastDot === -1 || lastDot < lastSlash) return FALLBACK_MIME;
  const ext = pathname
    .slice(lastDot + 1)
    .toLowerCase()
    .trim();
  if (ext === "") return FALLBACK_MIME;
  return EXT_TO_MIME[ext] ?? FALLBACK_MIME;
};
