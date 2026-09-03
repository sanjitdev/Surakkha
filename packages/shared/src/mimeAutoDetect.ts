/**
 * Extension-to-MIME lookup for attachment badges.
 * UX hint only — not a security boundary. The server trusts the
 * client's `mime` field after explicit regex validation; the detail
 * page renders the MIME as a TEXT badge, never as a script tag.
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
  // Audio/video
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};

export const FALLBACK_MIME = "application/octet-stream";

/**
 * Infer the MIME type from a URL's extension. The URL must already
 * have been validated by `validateHttpUrl` (caller passes the parsed
 * pathname context); this helper does not re-validate.
 *
 * Returns `FALLBACK_MIME` when the pathname has no extension, the
 * extension is not in the whitelist, or the extension is upper-case
 * / has trailing whitespace (normalised before lookup).
 */
export const detectMimeFromURL = (urlString: string): string => {
  let pathname: string;
  try {
    const { pathname: parsedPath } = new URL(urlString);
    pathname = parsedPath;
  } catch {
    return FALLBACK_MIME;
  }
  const lastDot = pathname.lastIndexOf(".");
  const lastSlash = pathname.lastIndexOf("/");
  if (lastDot === -1 || lastDot < lastSlash) return FALLBACK_MIME;
  const ext = pathname
    .slice(lastDot + 1)
    .toLowerCase()
    .trim();
  if (ext === "") return FALLBACK_MIME;
  return EXT_TO_MIME[ext] ?? FALLBACK_MIME;
};
