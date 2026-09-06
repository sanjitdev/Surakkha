/**
 * `packages/web/vite.config.ts` — dev-server proxy contract pin.
 *
 * The web SPA calls into the api via these origins in dev (Vite
 * proxy on port 8080 → api on 3000). See the companion file
 * `nginx.routes.spec.ts` for the production nginx equivalent; this
 * file pins the dev-only contract.
 *
 * Why the `/admin` key MUST be a regex-prefixed string (and NOT a
 * literal string prefix):
 *
 *   The admin SPA tabs live at `/admin/simulator`,
 *   `/admin/thresholds`, `/admin/users`, `/admin/schools`, and
 *   `/admin/notifications`. On a hard reload of any of those URIs,
 *   Vite's dev server gets the request first. With the original
 *   `"/admin"` proxy key (string prefix), Vite matches by prefix —
 *   so `/admin/thresholds` IS captured and proxied to the api. The
 *   api has no `/admin/thresholds` route (it's the SPA route, not
 *   an API endpoint), so the request 401s. The browser renders the
 *   raw `{"error": "unauthorized"}` JSON and React Router never
 *   gets a chance to mount.
 *
 *   The same bug existed in production and was fixed in nginx.conf
 *   via `location = /admin/simulator { try_files /index.html =404; }`
 *   exact-match blocks before the `location /admin/` proxy block.
 *   The Vite config was never mirrored.
 *
 *   Vite's proxy supports two key forms (see
 *   vite/packages/vite/src/node/server/middlewares/proxy.ts,
 *   `doesProxyContextMatchUrl`):
 *     - Literal string: matched via `String.prototype.startsWith`.
 *     - Regex: any string starting with `^` is compiled via
 *       `new RegExp(context)` and tested against the URL.
 *
 *   The fix: change the `/admin` key from `"/admin"` (literal
 *   prefix) to `"^/admin/[^/]+/.+"` (regex requiring the path to
 *   start with `/admin/<segment>/<resource>` — a non-slash section
 *   name like `simulator` followed by at least one more
 *   character). Real admin API calls like
 *   `/admin/thresholds/rules`, `/admin/simulator/status`,
 *   `/admin/simulator/devices` all match the regex and forward to
 *   the api. The bare SPA URIs (`/admin/simulator`,
 *   `/admin/thresholds`, `/admin/users`, `/admin/schools`,
 *   `/admin/notifications`) have only ONE segment after `/admin/`
 *   and so do NOT match — they fall through to Vite's normal SPA
 *   serving (`index.html`), and React Router takes over.
 *
 * This source-walk test pins the proxy keys + the regex form so a
 * future edit that re-introduces the string-prefix form (or drops a
 * non-admin route) is caught. Mirrors the shape of
 * `nginx.routes.spec.ts` — text-shape, no Vite runtime required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolve vite.config.ts relative to THIS file. Spec lives at
// packages/web/src/__tests__/vite.proxy.spec.ts; config lives at
// packages/web/vite.config.ts — that's three levels up from the spec.
const HERE = dirname(fileURLToPath(import.meta.url));
const VITE_CONFIG_PATH = join(HERE, "..", "..", "vite.config.ts");
const readViteConfig = (): string => readFileSync(VITE_CONFIG_PATH, "utf8");

/**
 * Pull every proxy key out of `proxy: { ... }`. Vite supports two
 * key forms: literal string (`"/api"`) or regex-prefixed string
 * (`"^/admin/[^/]+/.+"` — any string starting with `^` is treated
 * as a regex by `doesProxyContextMatchUrl`). This parser returns
 * the kind and value for each key. Skips comments.
 */
const proxyKeys = (
  config: string,
): Array<{ readonly kind: "string" | "regex"; readonly value: string }> => {
  const out: Array<{ readonly kind: "string" | "regex"; readonly value: string }> = [];
  const proxyStart = config.search(/proxy\s*:\s*\{/);
  if (proxyStart < 0) return out;
  let depth = 0;
  const openerIdx = config.indexOf("{", proxyStart);
  let i = openerIdx;
  while (i < config.length) {
    const ch = config[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const body = config.slice(openerIdx + 1, i);
        for (const rawLine of body.split("\n")) {
          const trimmed = rawLine.trim();
          // String key: `"/api": { ... }` or `"^/admin/.+": { ... }`.
          const stringKey = trimmed.match(/^"([^"]+)"\s*:\s*\{/);
          if (stringKey && stringKey[1] !== undefined) {
            const value = stringKey[1];
            // Vite treats any string starting with `^` as a regex
            // (see vite/packages/vite/src/node/server/middlewares/
            // proxy.ts: `doesProxyContextMatchUrl`).
            const kind: "string" | "regex" = value.startsWith("^") ? "regex" : "string";
            out.push({ kind, value });
            continue;
          }
        }
        return out;
      }
    }
    i++;
  }
  return out;
};

/**
 * Test whether the given path matches any proxy key, mirroring
 * Vite's actual routing semantics:
 *   - String keys: prefix-matched via `path === key || path.startsWith(`${key}/`)`
 *     (the trailing-slash form is what Vite uses — see the
 *     `url.startsWith(context)` branch in `doesProxyContextMatchUrl`).
 *   - Regex keys: compiled via `new RegExp(value)` and tested against
 *     the path.
 */
const proxyMatches = (
  stringKeys: readonly string[],
  regexKeysRaw: ReadonlyArray<{ readonly value: string }>,
  path: string,
): boolean => {
  for (const k of stringKeys) {
    if (path === k || path.startsWith(`${k}/`)) return true;
  }
  for (const k of regexKeysRaw) {
    try {
      const re = new RegExp(k.value);
      if (re.test(path)) return true;
    } catch {
      // Invalid regex source — the "regex compiles" assertion
      // below will flag it for the developer.
    }
  }
  return false;
};

describe("web vite.config.ts — dev proxy route coverage", () => {
  const config = readViteConfig();
  const keys = proxyKeys(config);
  const stringKeys = keys.filter((k) => k.kind === "string").map((k) => k.value);
  const regexKeysRaw = keys.filter((k) => k.kind === "regex");

  it("proxies /auth, /api, /ingest, /dashboard, /socket.io via string-prefix keys", () => {
    // Mirror of nginx.conf's /auth/, /api/, /ingest/, /dashboard/,
    // /socket.io/ prefix locations. If any of these vanish the SPA
    // breaks in dev (login 404s, dashboard realtime never connects,
    // etc.).
    for (const path of ["/auth", "/api", "/ingest", "/dashboard", "/socket.io"]) {
      expect(stringKeys, `expected string-prefix proxy key for ${path}`).toContain(path);
    }
  });

  it("uses a regex-prefixed string (NOT a literal string prefix) for the /admin proxy", () => {
    // The bug: a bare string `"/admin"` proxy entry captures bare
    // SPA URIs like `/admin/thresholds` and proxies them to the
    // api, which 401s — the browser renders the raw JSON and React
    // Router never mounts. The fix replaces the string key with a
    // regex-prefixed string (`"^/admin/[^/]+/.+"`) that requires
    // TWO segments after `/admin/` — a section + a resource.
    expect(stringKeys, "string-prefix /admin key must be removed").not.toContain("/admin");
    const adminRegex = regexKeysRaw.find((k) => k.value.includes("admin"));
    expect(adminRegex, "expected a regex proxy key for the /admin route").toBeDefined();
  });

  it("/admin regex requires at least two segments after /admin/", () => {
    // The regex source must anchor at the start of the path AND
    // require `/admin/<section>/<resource>` — i.e. the path needs
    // at least TWO non-empty segments after `/admin/`. Bare SPA
    // URIs like `/admin/simulator` have only ONE segment after
    // `/admin/` and so MUST NOT match; admin API URIs like
    // `/admin/simulator/status` MUST match. The two constraints
    // pinned below keep both halves in place so a future edit that
    // loosens the regex (e.g. drops `^` or drops the `[^/]+/.+`)
    // gets caught.
    const adminRegex = regexKeysRaw.find((k) => k.value.includes("admin"));
    expect(adminRegex, "expected a regex key mentioning admin").toBeDefined();
    const source = adminRegex!.value;
    // `^` anchored at start of path.
    expect(source.startsWith("^"), "admin regex must anchor at start of path").toBe(true);
    // `\/admin\/[^/]+\/.+` — literal `/admin/` followed by a
    // non-slash segment (the section name) and a slash followed by
    // at least one more character (the resource).
    expect(source, "admin regex must require a non-slash section + a /<resource>").toMatch(
      /\/admin\/\[\^\/\]\+\/\.\+/,
    );
    // Sanity: the regex source compiles cleanly.
    expect(() => new RegExp(source)).not.toThrow();
  });

  it.each([
    // Real admin API paths the SPA calls — these MUST be proxied
    // to the api. Sourced from `apiFetch("/admin/...")` call sites
    // in packages/web/src and the api's router definitions in
    // packages/api/src/admin/{thresholds,simulator}Router.ts.
    "/admin/thresholds/rules",
    "/admin/thresholds/rules/abc-123",
    "/admin/thresholds/rules/abc-123/activate",
    "/admin/simulator/status",
    "/admin/simulator/devices",
    "/admin/simulator/abc-123/scenario",
  ])("proxies admin API path %s to the api", (path) => {
    expect(
      proxyMatches(stringKeys, regexKeysRaw, path),
      `expected ${path} to match a proxy key`,
    ).toBe(true);
  });

  it.each([
    // Bare SPA URIs — these MUST fall through to Vite's SPA
    // serving so React Router can mount. They are NOT proxied
    // to the api. Mirrors the `location = /admin/<segment>`
    // exact-match blocks in nginx.conf (lines 60-64).
    "/admin/simulator",
    "/admin/notifications",
    "/admin/thresholds",
    "/admin/users",
    "/admin/schools",
  ])("does NOT proxy bare SPA URI %s (so React Router can mount on reload)", (path) => {
    // The bare `/admin/<segment>` URIs are the React Router
    // `<Route>` paths. If the Vite proxy captures them, the api
    // 401s and the browser renders raw JSON — the user sees an
    // "unauthorized error" until they navigate to `/` first. The
    // fix: regex `^/admin/[^/]+/.+` does NOT match these (they
    // have only ONE segment after `/admin/` and the regex needs
    // TWO — a section + a resource), so Vite serves index.html
    // and React Router takes over.
    expect(
      proxyMatches(stringKeys, regexKeysRaw, path),
      `expected ${path} NOT to match any proxy key`,
    ).toBe(false);
  });

  it("non-admin routes fall through to Vite's SPA serving", () => {
    // Sanity: `/`, `/login`, `/admin` are NOT proxied — they're
    // served by Vite as SPA routes. (`/dashboard` IS proxied by
    // the `/dashboard` prefix entry, but the api only mounts a
    // Socket.IO namespace there, so a GET 404s with a JSON error
    // body that no SPA reload produces — the SPA navigates to
    // `/dashboard` as the root React Router route, not as a
    // fetch. That's a separate concern from the `/admin/*` SPA
    // vs API disambiguation.)
    for (const path of ["/", "/login", "/admin"]) {
      expect(
        proxyMatches(stringKeys, regexKeysRaw, path),
        `expected ${path} NOT to match any proxy key`,
      ).toBe(false);
    }
  });
});
