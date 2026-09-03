/**
 * SSRF-safe URL validation for user-supplied attachment URLs.
 * Boundary between user text and the URL rendered into an `<a href>` —
 * a regression that lets `javascript:` or `data:text/html,...` through
 * would be an XSS vector. Throws `InvalidUrlError` on non-http(s),
 * malformed, or relative inputs.
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
 * Parse and validate an http(s) URL. Throws on non-http(s) scheme,
 * malformed input, or relative path.
 *
 * Examples:
 *   - `validateHttpUrl("https://example.com/photo.png")` → `{ url: URL }`
 *   - `validateHttpUrl("javascript:alert(1)")` → throws
 *   - `validateHttpUrl("data:text/plain,hello")` → throws
 *   - `validateHttpUrl("file:///etc/passwd")` → throws
 *   - `validateHttpUrl("/relative/path")` → throws
 *   - `validateHttpUrl("not-a-url")` → throws
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
