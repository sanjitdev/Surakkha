/**
 * Vite dev config — Surakkha web.
 *
 * The SPA always fetches `/api/*` (same-origin). When `pnpm dev` runs
 * the api natively on port 3000, this proxy forwards:
 *   - /auth/*    -> http://localhost:3000/auth/*   (login + refresh cookies)
 *   - /api/*     -> http://localhost:3000/api/*    (REST cold-load)
 *   - /admin/<section>/<resource> -> http://localhost:3000/admin/... (admin API)
 *   - /ingest/*  -> http://localhost:3000/ingest/*  (Socket.IO HTTP handshake)
 *   - /socket.io/*  (Socket.IO engine for /ingest and /dashboard namespaces)
 *
 * Without this proxy, the SPA would 404 on /api/* in dev. In production
 * the reverse proxy / orchestration layer is responsible for the same
 * routing — see nginx.conf.
 *
 * Why the `/admin` key is a regex-prefixed string (`"^/admin/[^/]+/.+"`)
 * and NOT a literal string prefix (`"/admin"`): the admin SPA tabs
 * (`/admin/simulator`, `/admin/thresholds`, `/admin/users`,
 * `/admin/schools`, `/admin/notifications`) need to reload cleanly.
 * With a string-prefix proxy entry like `"/admin"`, Vite forwards
 * those bare URIs to the api, which 401s (the api has no
 * `/admin/thresholds` route — that's the SPA route, not an API
 * endpoint) — the browser renders the raw
 * `{"error": "unauthorized"}` JSON and React Router never mounts.
 *
 * Vite's proxy keys can be either a literal string (matched via
 * `String.prototype.startsWith`) or a regex (any string starting
 * with `^` is compiled via `new RegExp(context)` and matched
 * against the request URL — see
 * vite/packages/vite/src/node/server/middlewares/proxy.ts,
 * `doesProxyContextMatchUrl`). The regex `"^/admin/[^/]+/.+"` matches
 * any URL whose path starts with `/admin/<segment>/<resource>` — a
 * `<section>` (e.g. `simulator`, `thresholds`) plus a `<resource>`
 * (e.g. `status`, `rules`, `devices`) — so `/admin/simulator/status`,
 * `/admin/thresholds/rules`, `/admin/simulator/<uuid>/scenario` are
 * proxied. The bare SPA URIs (`/admin/simulator`, `/admin/thresholds`,
 * `/admin/users`, `/admin/schools`, `/admin/notifications`) have
 * only ONE segment after `/admin/` and so do NOT match — they fall
 * through to Vite's normal SPA serving (`index.html`), letting
 * React Router take over. This mirrors the nginx exact-match
 * `location = /admin/<segment> { … }` blocks in nginx.conf
 * (lines 60-64), which intercept the bare SPA URIs before the
 * `location /admin/` proxy.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    strictPort: true,
    host: "0.0.0.0",
    proxy: {
      "/auth": { target: API_TARGET, changeOrigin: true },
      "/api": { target: API_TARGET, changeOrigin: true },
      // `"^/admin/[^/]+/.+"` — Vite treats any proxy key starting
      // with `^` as a regex (via `new RegExp(context).test(url)`).
      // The pattern requires the path to start with `/admin/`
      // followed by a non-slash segment (the section, e.g.
      // `simulator`) and then at least one more character (the
      // resource, e.g. `status`, `rules`, `devices`). The bare SPA
      // URIs (`/admin/simulator`, `/admin/thresholds`,
      // `/admin/users`, `/admin/schools`, `/admin/notifications`)
      // have only ONE segment after `/admin/` and so do NOT match
      // — they fall through to Vite's SPA serving (`index.html`).
      // Real admin API calls (`/admin/simulator/status`,
      // `/admin/thresholds/rules`, `/admin/simulator/<uuid>/scenario`,
      // etc.) match and forward to the api as intended.
      "^/admin/[^/]+/.+": { target: API_TARGET, changeOrigin: true },
      "/ingest": { target: API_TARGET, changeOrigin: true, ws: true },
      "/dashboard": { target: API_TARGET, changeOrigin: true, ws: true },
      "/socket.io": { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});
