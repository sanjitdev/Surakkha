/**
 * `API_ORIGIN` contract pin.
 *
 * The apiClient constructs URLs as `${apiOrigin}${path}` (or
 * `${apiOrigin}/auth/login` / `${apiOrigin}/auth/refresh` directly).
 * apiOrigin MUST be empty so the path stays `/auth/login`,
 * `/api/readings/latest`, `/api/devices`, etc. — matching the api
 * routes mounted at `/auth`, `/api/readings/latest`, `/api/devices`,
 * etc.
 *
 * If apiOrigin is `"/api"` (the previous broken value), the URL
 * becomes `/api/auth/login` (api has no such route → 401),
 * `/api/api/readings/latest` (api has no `/api/api/...` → 404 →
 * 401 via auth middleware), etc.
 *
 * The nginx config (packages/web/nginx.conf) and Vite proxy
 * (packages/web/vite.config.ts) both route `/auth` and `/api` to
 * `http://api:3000`. They do NOT strip the `/api` prefix, so the
 * SPA must NOT prepend it.
 *
 * `API_ORIGIN` is declared in `main.tsx` (the entry file) and
 * consumed in `ApiClientProvider.tsx` — `configureApiClient` lives
 * in the provider so it runs exactly once at app boot, covering
 * BOTH the `/login` submit path (calls `apiLogin`) AND any
 * protected surface (calls `apiFetch`). The actual value lives in
 * the import-deduped `./apiOrigin` module; `main.tsx` re-exports
 * it so the declaration site stays in the entry file the spec
 * pins. The spec pins the declaration (via re-export form too)
 * AND the consumption so future edits can't reintroduce the `/api`
 * prefix regression AND can't split the constant from its
 * consumer.
 *
 * Mirrors the shape of
 *   packages/web/src/__tests__/nginx.routes.spec.ts
 *   packages/simulator/src/__tests__/wsUrlContract.spec.ts
 * — text-shape, no runtime required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// Spec: packages/web/src/__tests__/apiOrigin.spec.ts
// Declaration source: packages/web/src/main.tsx — one level up.
const MAIN_PATH = join(HERE, "..", "main.tsx");
// Consumer source: packages/web/src/api/ApiClientProvider.tsx —
// one level up + into api/.
const PROVIDER_PATH = join(HERE, "..", "api", "ApiClientProvider.tsx");
// Value source: packages/web/src/apiOrigin.ts — one level up.
const API_ORIGIN_PATH = join(HERE, "..", "apiOrigin.ts");
const readFile = (path: string): string => readFileSync(path, "utf8");

describe("web API_ORIGIN contract", () => {
  const main = readFile(MAIN_PATH);
  const provider = readFile(PROVIDER_PATH);

  it("main.tsx surfaces `API_ORIGIN` (declaration or re-export)", () => {
    // Accepts BOTH the direct-declaration form
    //   `const API_ORIGIN = "";` / `export const API_ORIGIN = "";`
    // and the re-export form
    //   `export { API_ORIGIN } from "./apiOrigin";`
    // so the constant can live in the import-deduped `./apiOrigin`
    // module without losing its source-walk declaration site.
    expect(main).toMatch(
      /(?:(?:export\s+)?const\s+API_ORIGIN\s*=|export\s*\{\s*API_ORIGIN\s*\}\s*from)/,
    );
  });

  it("API_ORIGIN's value is pinned to empty string in the apiOrigin module", () => {
    // main.tsx re-exports `API_ORIGIN` from `./apiOrigin` so the
    // single source of truth for the value lives there. The next
    // assertion verifies the module, not main.tsx.
    const apiOriginModule = readFile(API_ORIGIN_PATH);
    expect(apiOriginModule).toMatch(
      /(?:export\s+const\s+API_ORIGIN|const\s+API_ORIGIN)\s*=\s*""\s*;/,
    );
  });

  it("does NOT set API_ORIGIN to a non-empty path", () => {
    // Belt and braces against the regression: a stray `"/api"`,
    // `"http://localhost:3000"`, etc. would all break the URL
    // construction in apiClient.
    const apiOriginModule = readFile(API_ORIGIN_PATH);
    expect(apiOriginModule).not.toMatch(
      /(?:export\s+const\s+API_ORIGIN|const\s+API_ORIGIN)\s*=\s*"\/[^"]+"\s*;/,
    );
  });

  it("ApiClientProvider wires apiOrigin: API_ORIGIN into the apiClient config", () => {
    // The configuration call must pass API_ORIGIN (the constant),
    // not a hard-coded value, so the contract stays in one place.
    // Lives in ApiClientProvider.tsx (not main.tsx or ProtectedShell)
    // so it runs exactly once at app boot — preceding BOTH the
    // /login submit path (apiLogin) and any protected surface
    // (apiFetch after RequireAuth passes).
    expect(provider).toMatch(/apiOrigin:\s*API_ORIGIN/);
  });
});
