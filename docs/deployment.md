# Surakkha — Deployment Plan (Tracking Document)

**Status:** Deferred until project completion. This document captures the decision space, constraints, and concrete next steps so we don't lose context. **Do not execute** until the user signals we're ready to ship.

**Owner:** TBD
**Target trigger:** When the final story ships and `pnpm -r test && pnpm -r typecheck && pnpm -r lint` all green on `main`.

---

## 1. What needs hosting

| Component | Runtime constraints | Why it's hard |
|---|---|---|
| `packages/web` (Vite + React SPA) | Pure static assets | Trivial — any CDN |
| `packages/api` (Express + Socket.IO + Prisma) | Long-lived Node process, **WebSocket connections**, cron (retention sweep), Postgres pool | Vercel Functions can't host a WS server on the free tier for >5 min without reconnects |
| `packages/simulator` (Node + Socket.IO client) | Long-lived process opening 6 WS connections | Same problem — not a serverless workload |
| Postgres | Persistent storage, connection pooling | Free tiers cap storage + compute hours |

**Hardest constraint:** The api's Socket.IO server (`/ingest/<uuid>` for devices, `/dashboard` for operators) is the entire reason this app exists. Any hosting plan that can't run it cleanly is a non-starter.

---

## 2. Hosting options — honest assessment

| Option | web | api (Node + WS) | simulator | Postgres | Free tier reality |
|---|---|---|---|---|---|
| **All Vercel + laptop simulator** | Vercel CDN | Vercel Functions | laptop-only | Vercel Postgres (Neon under hood) | All free, but **5-min WS reconnect on free tier** — our reconnect logic handles it but data flow looks stuttery |
| **Vercel + Fly.io + Neon** | Vercel CDN | Fly.io free VMs (3 × 256 MB) | Fly.io free VMs | Neon free (0.5 GB) | All genuinely free; Fly needs credit card on file (won't charge under free tier) |
| **Vercel + Render** | Vercel CDN | Render free tier | Render free tier | Render Postgres | **Render free tier spins down after 15 min idle** → WS drops constantly. Not viable. |
| **All Fly.io + Neon** | Fly static assets | Fly VMs | Fly VMs | Neon free | Single platform, no global CDN for SPA — slower first-load than Vercel |
| **Railway** | n/a | n/a | n/a | n/a | **No permanent free tier** since2024 — $5 trial credit only |
| **Cloudflare Workers + DO** | Cloudflare | Workers + Durable Objects | needs rewrite | D1 (SQLite, 500 MB) | Requires a Socket.IO → DO rewrite. Months of work. |

---

## 3. Recommended path — Vercel + Fly.io + Neon (Option 2)

Best balance of "actually free" + "matches the architecture" + "smallest amount of code change."

### Why not all-Vercel (Option 1)?

- 5-min WS reconnects on free tier are ugly. Real devices would appear to drop every 5 minutes even when they're fine.
- Forces the simulator to run locally — fine for a demo but not for "show anyone, anytime."

### Why not all-Fly (Option 3)?

- No CDN for the SPA. First-load latency for users far from the data center is noticeably worse than Vercel's edge network.
- Fly's free VMs are small (256 MB) — the api might struggle with the Prisma client + Socket.IO + pino + the dashboard realtime fan-out.

### Why Vercel + Fly + Neon?

- Vercel serves the SPA from its global CDN (sub-50 ms first-load anywhere).
- Fly.io free tier gives the api + simulator real VMs with persistent WS connections — no 5-min cap.
- Neon free tier gives0.5 GB Postgres with branching — enough for a demo with 6 devices.
- All three have permanent free tiers (no trial credit).
- Single credit card (Fly only). Vercel + Neon stay completely free.

---

## 4. Concrete work to do (when ready)

Listed in dependency order. Each step has a clear "done" condition.

### Step 1: Vercel SPA prep (no api changes)

- [ ] Add `vercel.json` at the repo root pinning build to `packages/web/`:
  ```json
  {
    "buildCommand": "cd packages/web && pnpm install --frozen-lockfile && pnpm build",
    "outputDirectory": "packages/web/dist",
    "framework": null
  }
  ```
- [ ] Replace `const API_ORIGIN = "";` (packages/web/src/main.tsx) with a runtime-injected env var: `import.meta.env["VITE_API_ORIGIN"] ?? ""`. Update `apiOrigin.spec.ts` to pin the new shape.
- [ ] Add `VITE_API_ORIGIN` to `.env.example` documenting dev (`""`) vs prod (`https://surakkha-api.fly.dev`) values.

**Done when:** `vercel deploy --prod` from the repo root produces a public URL that serves the SPA, and the SPA loads with a "Cannot reach api" empty state (because the api isn't deployed yet — that's fine for step 1).

### Step 2: Fly.io api deploy

- [ ] Add `Dockerfile.fly` (or reuse `packages/api/Dockerfile` after verifying Fly's builder accepts it — it should, since it's already multi-stage with `node:20-bookworm-slim`).
- [ ] Add `packages/api/fly.toml`:
  - App name: `surakkha-api`
  - Region: closest to Neon region (likely `sin` for Bangladesh context, `iad` for US)
  - Internal port: 3000
  - Env: `JWT_SECRET`, `DATABASE_URL` (Neon pooled URL), `SIMULATOR_SECRET`, `NODE_ENV=production`, `LOG_LEVEL=info`
  - `[[services.tcp]]` block: nothing — api is HTTP+WS only.
  - `[[services.ports]]` for WS — Fly's `handlers = ["http"]` covers WS.
- [ ] Add `DATABASE_URL` Neon connection string via `fly secrets set DATABASE_URL=...` (do not commit).
- [ ] Run migrations from local host pointing at Neon: `pnpm -F @surakkha/db exec prisma migrate deploy`.
- [ ] `fly deploy` — verify `https://surakkha-api.fly.dev/health` returns 200.
- [ ] Smoke-test: `curl https://surakkha-api.fly.dev/api/devices -H "Authorization: Bearer <token>"` returns the seeded 6 devices.

**Done when:** api is publicly reachable, responds to REST + WS from the internet.

### Step 3: Fly.io simulator deploy (optional)

- [ ] Add `packages/simulator/fly.toml`:
  - App name: `surakkha-simulator`
  - Region: same as api (or wherever Neon is)
  - Env: `JWT_SECRET` (matches api), `API_URL=https://surakkha-api.fly.dev`, `SIMULATOR_SECRET`, `NODE_ENV=production`
- [ ] `fly deploy` — verify logs show all 6 devices reaching `simulator: connected`.

**Done when:** 6 devices continuously streaming, dashboard shows live data.

### Step 4: Neon Postgres

- [ ] Create Neon project (free tier, region near Fly's region).
- [ ] Copy pooled connection string + direct connection string.
- [ ] Run migrations from local host pointing at Neon's pooled URL.
- [ ] Seed devices if needed.
- [ ] Update `DATABASE_URL` secret on Fly.

### Step 5: Vercel-side wiring

- [ ] `vercel link` to create the project.
- [ ] `vercel env add VITE_API_ORIGIN production` — set to `https://surakkha-api.fly.dev`.
- [ ] `vercel deploy --prod`.
- [ ] Smoke-test the deployed URL end-to-end:
  - Login as admin → SPA loads, JWT stored.
  - Dashboard shows 6 devices with live `last_reading_at`.
  - Simulator tab (if step 3 done) shows scenario list.
- [ ] Set up custom domain (optional, free with Vercel).

**Done when:** Public URL shows the full Surakkha dashboard with live telemetry.

---

## 5. Alternative paths (decision records)

### Why not Option 1 (all Vercel + laptop simulator)?

- 5-min WS reconnect on free tier. Our `WsClient` reconnect logic handles it cleanly (verified during docker bring-up — devices reconnect after rate-limit windows with no data loss), but for a demo it's a visible "blip" every 5 min.
- Forces the simulator to live on someone's laptop. Can't share a demo URL with stakeholders unless they're in the same room.
- **Revisit if:** the dashboard stutters are acceptable AND you want to avoid a Fly.io account.

### Why not Option 3 (all Fly.io)?

- No CDN. First-load latency for users far from `sin`/`iad` is 200-500 ms vs Vercel's sub-50 ms.
- Fly free VMs are small. The api (Prisma + Socket.IO + pino) might OOM at256 MB under load.
- **Revisit if:** we want a single-platform deploy and don't mind slower first-load.

### Why not Cloudflare Workers + Durable Objects?

- Requires rewriting Socket.IO server as a Durable Object. Months of work.
- D1 is SQLite (500 MB free). Migration from Postgres → D1 would lose some features (full-text search, JSONB queries used in audit rows).
- **Revisit if:** Surakkha is going to be deployed at scale and the rewrite cost amortises.

---

## 6. Cost ceiling (if we ever exceed free tiers)

| Tier | Vercel | Fly.io | Neon | Total |
|---|---|---|---|---|
| **Free (current target)** | $0 | $0 (with card on file) | $0 | **$0/mo** |
| Low-traffic demo (Pro) | $20 | $0 (3 free VMs) | $0 (0.5 GB) | **$20/mo** |
| Production scale | $20 + usage | ~$10 | $19 | ~$50/mo |

Numbers from each platform's public pricing pages as of 2026-08.

---

## 7. Open questions for the user

1. **Domain:** Do you want `surakkha.vercel.app` (free, instant), `surakkha.fly.dev` (free, less memorable), or a custom domain? Custom domains are free with Vercel.
2. **Simulator in production:** Run it on Fly (always-on synthetic data), or on your laptop (manual start for demos)? Or skip it entirely (real devices only)?
3. **Region:** Vercel auto-routes globally. Fly needs a region choice. Neon needs a region. Pick based on where your demo audience is — Bangladesh (`sin`), India (`blr`), US (`iad`), EU (`fra`).
4. **Migration runner:** Run Prisma migrations from your laptop pointing at Neon's pooled URL, or set up a one-off Fly machine that runs migrations on deploy? Latter is cleaner but requires a deploy hook.

---

## 8. What we have today (already deployed-ready)

These already work as-is and don't need changes for any hosting path:

- `packages/api/Dockerfile` — multi-stage `node:20-bookworm-slim` with Prisma client baked in. Works on Fly.io directly.
- `packages/web/Dockerfile` — nginx-served static SPA. Works on Fly.io static or any CDN.
- `packages/simulator/Dockerfile` — multi-stage simulator image with `devices.json` properly copied into `dist/`. Works on Fly.io directly.
- `docker-compose.dev.yml` — local dev stack with all 3 services + host Postgres. Already verified end-to-end.
- All 8 commits on `origin/main` after the 2026-08-25 docker bring-up session.

The remaining work is configuration + small refactors (Steps 1-5 above), not code rewrites.

---

**Last updated:** 2026-08-25 (after the docker bring-up session). Review again when project completion is in sight.