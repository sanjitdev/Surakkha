/**
 * `packages/web/nginx.conf` — proxy-route contract pin.
 *
 * The web SPA calls into the api via these origins (see
 * packages/web/src/api/apiClient.ts and packages/web/src/main.tsx):
 *
 *   - `/auth/login`, `/auth/refresh`         (REST, HttpOnly cookie)
 *   - `/api/readings/latest`, `/api/incidents/recent`,
 *     `/api/devices`                         (REST)
 *   - `/admin/simulator/status`,
 *     `/admin/simulator/devices`,
 *     `/admin/simulator/<uuid>/scenario`,
 *     `/admin/thresholds`, `/admin/users`,
 *     `/admin/schools`                        (admin tabs)
 *   - `/ingest/<uuid>`                       (Socket.IO WS, devices)
 *   - `/dashboard`                           (Socket.IO WS, operators)
 *   - `/socket.io`                           (Socket.IO engine handshake)
 *   - `/health`                              (api healthcheck passthrough)
 *
 * The nginx config is the only thing that bridges these from the
 * browser origin to the api container at `http://api:3000`. If any
 * route disappears, the SPA silently breaks (login form 404s,
 * realtime dashboard never connects, simulator can't ingest, etc.).
 *
 * This source-walk test pins every route's existence. Mirrors the
 * shape of packages/api/__tests__/boot.skipMigrations.spec.ts and
 * packages/api/__tests__/health.public.spec.ts — text-shape, no
 * runtime nginx server required.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolve nginx.conf relative to THIS file so the test is robust to
// whether vitest is invoked from the repo root or from packages/web.
// File lives at packages/web/src/__tests__/nginx.routes.spec.ts;
// nginx.conf lives at packages/web/nginx.conf — that's two levels up
// from the spec.
const HERE = dirname(fileURLToPath(import.meta.url));
const NGINX_CONF_PATH = join(HERE, "..", "..", "nginx.conf");
const readNginxConf = (): string => readFileSync(NGINX_CONF_PATH, "utf8");

/** Pull every `location <prefix> {` block header out of the file. */
const locationPrefixes = (conf: string): string[] => {
  const out: string[] = [];
  for (const raw of conf.split("\n")) {
    const line = raw.trim();
    // Match `location /path/` and `location = /health` (exact-match form).
    const m = line.match(/^location\s+([=~^]*\s*"?[^"{]+"?)\s*\{/);
    if (m && m[1] !== undefined) {
      out.push(m[1].replace(/"/g, "").trim());
    }
  }
  return out;
};

describe("web nginx.conf — proxy route coverage", () => {
  const conf = readNginxConf();
  const prefixes = locationPrefixes(conf);

  it("proxies /api/ to the api container", () => {
    expect(prefixes).toContain("/api/");
    expect(conf).toMatch(/location\s+\/api\/\s*\{[\s\S]*proxy_pass\s+http:\/\/api:3000/);
  });

  it("proxies /auth/ to the api container (login + refresh cookies)", () => {
    expect(prefixes).toContain("/auth/");
    expect(conf).toMatch(/location\s+\/auth\/\s*\{[\s\S]*proxy_pass\s+http:\/\/api:3000/);
  });

  it("proxies /admin/ to the api container (admin tabs)", () => {
    // The simulator / thresholds / users / schools SPA tabs call
    // `/admin/...` via apiFetch. Without this block nginx falls
    // through to the SPA fallback and returns index.html (200 +
    // HTML); apiFetch JSON-parses it and fails — the tab shows
    // "Failed to load …". This regression appeared once already; the
    // contract pin keeps the location block in place.
    expect(prefixes).toContain("/admin/");
    expect(conf).toMatch(/location\s+\/admin\/\s*\{[\s\S]*proxy_pass\s+http:\/\/api:3000/);
  });

  it("proxies /ingest/ to the api container with WS upgrade headers", () => {
    expect(prefixes).toContain("/ingest/");
    // WS upgrade headers are required for Socket.IO transport.
    // Without `Upgrade $http_upgrade`, the long-lived device
    // telemetry stream silently 426s on handshake.
    const ingestBlock = conf.match(
      /location\s+\/ingest\/\s*\{[\s\S]*?\n\s*\}/,
    );
    expect(ingestBlock).not.toBeNull();
    expect(ingestBlock![0]).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(ingestBlock![0]).toMatch(/proxy_set_header\s+Connection\s+"upgrade"/);
  });

  it("proxies /dashboard/ to the api container with WS upgrade headers", () => {
    expect(prefixes).toContain("/dashboard/");
    const block = conf.match(
      /location\s+\/dashboard\/\s*\{[\s\S]*?\n\s*\}/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(block![0]).toMatch(/proxy_set_header\s+Connection\s+"upgrade"/);
  });

  it("proxies /socket.io/ to the api container with WS upgrade headers", () => {
    expect(prefixes).toContain("/socket.io/");
    const block = conf.match(
      /location\s+\/socket\.io\/\s*\{[\s\S]*?\n\s*\}/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(block![0]).toMatch(/proxy_set_header\s+Connection\s+"upgrade"/);
  });

  it("passthrough /health to the api", () => {
    // Exact-match form: `location = /health { proxy_pass ... }`.
    expect(conf).toMatch(/location\s+=\s+\/health\s*\{[\s\S]*proxy_pass\s+http:\/\/api:3000\/health/);
  });

  it("preserves the SPA fallback at /", () => {
    expect(conf).toMatch(/location\s+\/\s*\{[\s\S]*try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
  });
});