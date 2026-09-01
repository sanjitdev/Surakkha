# Surakkha — Dev Stack Runbook

**For:** Surakkha AI agent (or any operator) spinning up the local dev stack.
**Why this exists:** Every time we re-enter the project, we burned 30+ minutes rediscovering the boot order, the seed script gap, and the catch-all-404 regression. This runbook distils the **last working setup** into a single read.

> **TL;DR — bring it up:**
>
> ```bash
> # from C:\ZDrive Folders\Projects\Surakkha
> docker compose -f docker-compose.dev.yml build api web
> docker compose -f docker-compose.local.yml up -d
> # then seed the dev fixtures (one-time per DB) — see §4
> ```
>
> Open `http://localhost:8080/` → log in → Kanban board at `/incidents`.

---

## 1. Topology

| Container            | Image                           | Port | Purpose                                                                |
| -------------------- | ------------------------------- | ---- | ---------------------------------------------------------------------- |
| `surakkha-db`        | `postgres:15`                   | 5433 | Postgres (trust auth, volume `surakkha-pgdata-local`)                  |
| `surakkha-api`       | `surakkha-dev-api:latest`       | 3000 | Express + Socket.IO (`/health`, `/auth`, `/api/*`)                     |
| `surakkha-web`       | `surakkha-dev-web:latest`       | 8080 | Vite SPA served by nginx, talks to api via `host.docker.internal:3000` |
| `surakkha-simulator` | `surakkha-dev-simulator:latest` | —    | Ingestes telemetry for 6 demo devices every 2s                         |

Default login: `admin@surakkha.test` / `demo-admin` (Operator/Tech/Admin variants in `packages/api/src/auth/users.ts:43-67`).

## 2. The three compose files (and which one to use)

| File                       | Use case                                                            | Build? | Notes                                                                               |
| -------------------------- | ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `docker-compose.yml`       | Full self-contained stack (builds + runs everything)                | yes    | Use for fresh setups                                                                |
| `docker-compose.dev.yml`   | **Source-build** the api + web against host source                  | yes    | Build only — use to refresh `surakkha-dev-{api,web,simulator}:latest` cached images |
| `docker-compose.local.yml` | **Run** the cached `surakkha-dev-{api,web,simulator}:latest` images | no     | What you bring up day-to-day                                                        |

**Important quirk:** `docker-compose.local.yml` declares the api/web/simulator services with `image:` and NO `build:` directive. Running `docker compose -f docker-compose.local.yml build` does nothing. To rebuild the cached images after a source change, run `docker compose -f docker-compose.dev.yml build api web simulator`. Then `docker compose -f docker-compose.local.yml up -d` picks up the new images.

## 3. First-time setup (boot order)

```bash
# 1. .env must exist at the repo root with these keys (already present at .env):
#      JWT_SECRET=...  (64-char b64url)
#      SIMULATOR_SECRET=...
#      RETENTION_CRON=5 * * * *
#      POSTGRES_USER=surakkha
#      POSTGRES_PASSWORD=surakkha
#      POSTGRES_DB=surakkha
#    Verify: ls .env && grep ^JWT_SECRET .env

# 2. Build the cached images from current source:
docker compose -f docker-compose.dev.yml build api web simulator

# 3. Bring up the dev stack:
docker compose -f docker-compose.local.yml up -d

# 4. Verify all four containers are up + healthy:
docker ps --filter name=surakkha --format "{{.Names}} {{.Status}}"
#    expect: surakkha-api Up Xm (healthy), surakkha-web Up Xm (unhealthy OK early),
#            surakkha-simulator Up Xm, surakkha-db Up Xm (healthy)
```

`/health` on the api is the canonical liveness probe — `curl http://localhost:3000/health` should return 200 within 30s of `up -d`.

## 4. Seeding the DB (Story 3.3 + manual demo fixtures)

Two layers of seeds exist:

### 4a. FR-13 default rules + device IDs (Story 3.3)

The api's boot path ALSO hydrates rules from `packages/db/prisma/seed.ts` (Story 3.3 default thresholds), but that seed is only called by `pnpm seed` from the host, NOT by the container. The container hydrates its rules via `resolvePrismaRuleReader` at boot time so the in-memory cache matches what's in the DB — but if the DB has **zero** rules, the cache is empty and no Alerts fire.

For a fully-functioning dev stack, seed rules + devices from the host:

```bash
# Connect via host's DATABASE_URL (packages/db/.env points at postgresql://postgres:sanjit7265@localhost:5432/surakkha)
# — but the local docker-compose uses port 5433, so use port-forwarded URL or run seeds against docker network.

# Easier path — execute against the docker network:
docker run --rm --network surakkha-local \
  -v "$PWD:/repo" -w /repo \
  -e DATABASE_URL="postgresql://surakkha:surakkha@db:5432/surakkha" \
  node:20-bookworm-slim sh -c '
    corepack enable && corepack prepare pnpm@9.12.0 --activate
    cd packages/db
    node seed-rules.mjs
    node seed-devices.mjs
    node seed-incidents.mjs
  '
```

The three `seed-*.mjs` files at `packages/db/` were created to work around a broken `pnpm seed` (which expects `Rule.deviceId` nullable but the schema requires it):

| File                             | What it seeds                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/db/seed-devices.mjs`   | 6 demo devices (`SURAKKHA-A01..F06`) so simulator ingest doesn't hit FK violations          |
| `packages/db/seed-rules.mjs`     | 9 FR-13 default rules — but with `minDurationSeconds=0`/`hysteresisSeconds=0`               |
| `packages/db/seed-incidents.mjs` | 5 incidents across the Kanban states (OPEN → ACKNOWLEDGED → INSPECTING → MONITORING → SAFE) |

### 4b. CRITICAL — Story 3.4 de-bouncing boot guard

`packages/api/src/rules/hooks.ts` line 380-400 implements a **boot guard**: if any active Rule has BOTH `minDurationSeconds=0` AND `hysteresisSeconds=0`, the api throws `WriteAmplificationError(ruleIds)` and exits 78 (EX_CONFIG). This is **intentional** — the v1 rule engine rejects rules that would cause write amplification. The seed defaults bump `hysteresisSeconds=0` but if you seed rules fresh, you'll trigger the guard.

If the api container exits immediately after boot, run:

```bash
docker exec surakkha-db psql -U surakkha -d surakkha -c \
  'UPDATE "Rule" SET "hysteresisSeconds" = 10 WHERE "isActive" = true;'
docker restart surakkha-api
```

This is exactly what bit us on 2026-08-27 — the boot guard is working correctly, not a bug.

## 5. Smoke testing

```bash
# Login (admin)
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@surakkha.test","password":"demo-admin"}'

# Should return {access_token, token_type: "Bearer", expires_in: 28800}
# (Note: /auth/login — NO /api prefix)

# Web app
open http://localhost:8080/
# → login → click "Incidents" in nav → see Kanban with 5 seeded cards

# Click any card → /incidents/<uuid> → IncidentDetailPage with audit timeline
```

For scripted endpoint checks, see `tmp/probe.mjs` (committed). It logs in and hits every incident endpoint; expected results with the fix in place:

| Endpoint                              | Status | Body                                                 |
| ------------------------------------- | ------ | ---------------------------------------------------- |
| `GET /api/incidents/recent`           | 200    | `{incidents: [...]}`                                 |
| `GET /api/incidents/active`           | 200    | `{incidents: [...]}` (Story 4.3 Kanban feed)         |
| `GET /api/incidents/:id`              | 200    | `IncidentPayload` (Story 4.2)                        |
| `GET /api/incidents/:id/events`       | 200    | `{events: [...]}` (Story 4.4 timeline)               |
| `POST /api/incidents/:id/acknowledge` | 409    | `invalid_state_transition` (unless incident is OPEN) |

## 6. The five things that bit us (do not re-litigate)

### 6a. Catch-all 404 shadows any later router mount — DO NOT move it back

The catch-all 404 handler must be the LAST `app.use(...)` in `packages/api/src/index.ts`. Any router mounted AFTER it returns 404 for all paths. Discovered 2026-08-27: `app.use(buildIncidentsRouterMount(...))` was AFTER the 404 handler, so every `/api/incidents/{active,:id,...}` endpoint (except `/recent`, which had its own earlier mount) returned 404. Fix: moved the 404 handler below the adapter mount. **Regression test:** `packages/api/__tests__/catchall-404-order.spec.ts` (4 tests, source-walks `index.ts`).

### 6b. Auth login route is `/auth/login`, not `/api/auth/login`

The mounted prefix is `/auth` (line 81 of `packages/api/src/index.ts`). Probing `/api/auth/login` returns 404.

### 6c. The api container can report "healthy" while the api process is dead

The Docker healthcheck pings `/health` which never errors — if the api process dies (e.g. boot guard fires), the container keeps running. Always `docker logs surakkha-api` if endpoints return 404.

### 6d. `--ignore-scripts` in pnpm install breaks bcrypt

Both the api `Dockerfile` (line 33, line 96) and the dev compose build use `pnpm install --frozen-lockfile --ignore-scripts` to dodge the husky `prepare` hook. After install, **always** run `pnpm rebuild --filter @surakkha/api... bcrypt` — the postinstall script is what compiles bcrypt's native binding. Forgetting this gives `Could not locate the bindings file ... .node` at runtime.

### 6e. The cached image stays after a rebuild UNTIL containers are recreated

`docker compose -f docker-compose.dev.yml build api` updates `surakkha-dev-api:latest`. But `docker compose -f docker-compose.local.yml up -d api` on a **running** container does NOT recreate it (`up -d` no-ops if the service is already up). To force a fresh container from the new image:

```bash
docker compose -f docker-compose.local.yml up -d --force-recreate api
```

## 7. Tear-down

```bash
# Soft tear-down (keeps Postgres volume):
docker compose -f docker-compose.local.yml down

# Hard tear-down (also deletes the Postgres volume — re-seeds required on next boot):
docker compose -f docker-compose.local.yml down -v
```

The Postgres data lives in the `surakkha-pgdata-local` named volume. The api/web/simulator images stay cached on disk.

## 8. When something is broken — escalation matrix

| Symptom                                        | First check                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `curl :3000/health` times out                  | `docker logs surakkha-api --tail 50` — usually boot guard (see §4b)                   |
| `/api/incidents/active` returns 404            | 404 handler regression (§6a) — `pnpm -F @surakkha/api test catchall`                  |
| `pnpm seed` fails on FK violation              | Use `packages/db/seed-*.mjs` directly (see §4a)                                       |
| bcrypt "bindings not found" in api logs        | `pnpm rebuild --filter @surakkha/api... bcrypt` inside the container                  |
| `surakkha-simulator` won't start               | `docker logs surakkha-simulator` — usually `JWT_SECRET` mismatch                      |
| Kanban is empty even though seed-incidents ran | Check `docker logs surakkha-api` for hydration errors (api hydrates on boot)          |
| Login works but page is blank                  | Check browser console for `Failed to fetch /auth/login` — usually api process is dead |

## 9. Useful one-liners

```bash
# Tail all four containers at once
docker compose -f docker-compose.local.yml logs -f --tail 100

# Connect to the dev DB (port 5433 on host, mapped from container 5432)
PGPASSWORD=surakkha psql -h localhost -p 5433 -U surakkha -d surakkha

# Count incidents per state (sanity-check after seeding)
docker exec surakkha-db psql -U surakkha -d surakkha -c \
  'SELECT state, COUNT(*) FROM "Incident" GROUP BY state;'

# Watch the api's audit log for RBAC denials in real-time
docker logs -f surakkha-api 2>&1 | grep audit | grep -i denied

# Re-login as a different role for RBAC testing
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@surakkha.test","password":"demo-operator"}'
# (also: technician@surakkha.test / demo-technician, viewer@surakkha.test / demo-viewer)
```

## 10. Files created/changed in this session

These were created/modified to get from "broken dev stack" → "working dev stack":

| File                                                | Change                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/api/src/index.ts`                         | Moved catch-all 404 AFTER `app.use(buildIncidentsRouterMount(...))`                |
| `packages/api/__tests__/catchall-404-order.spec.ts` | NEW — 4-test source-walk regression pin                                            |
| `packages/db/seed-devices.mjs`                      | NEW — 6 demo devices workaround for broken `pnpm seed`                             |
| `packages/db/seed-rules.mjs`                        | NEW — 9 FR-13 default rules                                                        |
| `packages/db/seed-incidents.mjs`                    | NEW — 5 incidents across all states for Kanban visual verification                 |
| `packages/api/Dockerfile`                           | Added `--ignore-scripts` + `pnpm rebuild bcrypt` (passes the husky `prepare` hook) |
| `tmp/probe.mjs`                                     | NEW — diagnostic script that probes every incident endpoint after login            |

---

## 11. Monthly critique cadence (`/impeccable`)

The detector (`pnpm lint:impeccable`) catches drift at PR time. The
critique command catches drift between stories. The two are
complementary — the detector is mechanical and narrow; the critique
is heuristic and broad (Nielsen's 10 heuristics, scored 0–4, with
P0/P1 findings triaged into follow-up stories).

### Cadence

- **Monthly**, on the 1st, against both `packages/web` and
  `packages/api/src`. The
  `.github/workflows/impeccable-critique-reminder.yml` workflow
  opens a single `impeccable-critique` issue on the maintainer's
  queue on the 1st of each month so the cadence is visible
  without anyone having to remember it.
- **After any story** that touches `IncidentDetailPage`,
  `KanbanBoard`, `RbacDenied`, `AdminNotificationsPage`, or the
  api `transitionRoutes` / `recentRouter` / `applyTransition`
  surfaces — those are the surfaces the August critiques found
  most likely to drift.

### How to run it

The critique command is **agent-driven** (dual-agent heuristic
review); it cannot run headless in CI. Open Claude Code (or your
AI harness of choice) at the project root and run:

```
/impeccable critique packages/web
/impeccable critique packages/api/src
```

Each run writes an artifact to
`.impeccable/critique/<timestamp>__<slug>.md` (committed alongside
the triage PR). The slug is stable across runs (`packages-web`,
`packages-api-src-index-ts`); the timestamp is what makes the
trend legible in `git log .impeccable/critique/`.

### Triage policy

- **P0** — must be closed before the next release. Open a
  follow-up story immediately; PR-block on landing.
- **P1** — must be closed in the current sprint. Attach to the
  next web/api-touching story or open a new one.
- **P2** — back of the queue. Add to the next polish pass.
- **P3** — record in `.impeccable/critique/` only; close
  opportunistically.

### Why this is here, not in AGENTS.md

AGENTS.md §4.1 covers the per-story critique flow (run it before
opening the PR). This section covers the _cadence_ — when to run
it for the codebase as a whole. The detector catches single-PR
drift; the critique catches cumulative drift across stories. Both
are needed.

If a future Surakkha agent picks up this runbook cold, start at §3.
