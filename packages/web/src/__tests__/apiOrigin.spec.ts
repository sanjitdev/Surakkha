/**
 * `packages/web/src/main.tsx` `API_ORIGIN` contract pin.
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
// Source: packages/web/src/main.tsx — two levels up.
const MAIN_PATH = join(HERE, "..", "main.tsx");
const readMain = (): string => readFileSync(MAIN_PATH, "utf8");

describe("web main.tsx API_ORIGIN contract", () => {
  const src = readMain();

  it("declares `API_ORIGIN` (the constant the apiClient is configured with)", () => {
    expect(src).toMatch(/const\s+API_ORIGIN\s*=/);
  });

  it("API_ORIGIN is the empty string (same-origin)", () => {
    // The shape is `const API_ORIGIN = "";` — pinned so future edits
    // can't reintroduce the `/api` prefix and silently break the
    // SPA's login + REST flows.
    expect(src).toMatch(/const\s+API_ORIGIN\s*=\s*""\s*;/);
  });

  it("does NOT set API_ORIGIN to a non-empty path", () => {
    // Belt and braces against the regression: a stray `"/api"`,
    // `"http://localhost:3000"`, etc. would all break the URL
    // construction in apiClient.
    expect(src).not.toMatch(/const\s+API_ORIGIN\s*=\s*"\/[^"]+"\s*;/);
  });

  it("wires apiOrigin into the apiClient config", () => {
    // The configuration call must pass API_ORIGIN (the constant),
    // not a hard-coded value, so the contract stays in one place.
    expect(src).toMatch(/apiOrigin:\s*API_ORIGIN/);
  });
});