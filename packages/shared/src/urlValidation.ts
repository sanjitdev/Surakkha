/**
 * `validateHttpUrl` — pure helper that accepts a string and returns
 * `{ url: URL }` parsed if it's an http:// or https:// URL, throws
 * otherwise. Rejects every other scheme (`javascript:`, `data:`,
 * `file:`, `vbscript:`, `ftp:`, `mailto:`, etc.) plus relative paths
 * and malformed URLs.
 *
 * SECURITY: this is the boundary between user-supplied text and the
 * URL we render into an `<a href>`. A regression that lets
 * `javascript:` or `data:text/html,...` through would be an XSS
 * vector.
 *
 * The thrown error message is intentionally structured: it surfaces
 * to the web toast (so the operator sees "URL must be http:// or
 * https://") and to the api's 400 body (same message).
 */

export interface ValidatedUrl {
  readonly url: URL;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUrlError";
  }
}

/**
 * Parse and validate an http(s) URL string. Throws `InvalidUrlError`
 * on any non-http(s) scheme, malformed input, or relative path.
 *
 * Examples:
 *   - `validateHttpUrl("https://example.com/photo.png")` → `{ url: URL }`
 *   - `validateHttpUrl("javascript:alert(1)")` → throws
 *   - `validateHttpUrl("data:text/plain,hello")` → throws
 *   - `validateHttpUrl("file:///etc/passwd")` → throws
 *   - `validateHttpUrl("/relative/path")` → throws (relative)
 *   - `validateHttpUrl("not-a-url")` → throws (malformed)
 */
export const validateHttpUrl = (input: string): ValidatedUrl => {
  if (typeof input !== "string" || input.trim() === "") {
    throw new InvalidUrlError("URL must be a non-empty string");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidUrlError("URL must be http:// or https://");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidUrlError("URL must be http:// or https://");
  }
  return { url };
};
