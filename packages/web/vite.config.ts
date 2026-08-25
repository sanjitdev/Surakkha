/**
 * Vite dev config — Surakkha web.
 *
 * The SPA always fetches `/api/*` (same-origin). When `pnpm dev` runs
 * the api natively on port 3000, this proxy forwards:
 *   - /auth/*    -> http://localhost:3000/auth/*   (login + refresh cookies)
 *   - /api/*     -> http://localhost:3000/api/*    (REST cold-load)
 *   - /ingest/*  -> http://localhost:3000/ingest/*  (Socket.IO HTTP handshake)
 *   - /socket.io/*  (Socket.IO engine for /ingest and /dashboard namespaces)
 *
 * Without this proxy, the SPA would 404 on /api/* in dev. In production
 * the reverse proxy / orchestration layer is responsible for the same
 * routing — see nginx.conf.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
      "/ingest": { target: API_TARGET, changeOrigin: true, ws: true },
      "/dashboard": { target: API_TARGET, changeOrigin: true, ws: true },
      "/socket.io": { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
});