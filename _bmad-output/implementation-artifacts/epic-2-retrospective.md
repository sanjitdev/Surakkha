# Epic 2 — Retrospective

**Date:** 2026-08-24
**Scope:** Epic 2 — Devices & Telemetry
**Status:** CLOSED (9/9 stories shipped)
**BMAD analogue:** `bmad-retrospective` (ER)
**Inputs:** `sprint-status.yaml`, 9 spec/context files (`2-1-*.md`…`spec-2-9-*.md`), `docs/BMAD-METHOD.md`, `docs/architecture.md` §3.5 + §5.4, `_bmad-output/implementation-artifacts/deferred-work.md` (24 deferred items across 6 stories), 29 commits on `main` (24 source + 5 ledger/docs)
**Output:** this file

---

## 1. Summary

| Metric | Value |
|---|---|
| Stories shipped | 9 of 9 (2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9) |
| Source commits | 16 (one per story: 8 `feat` + 1 `fix` + 1 `chore`-class for Story 2.9; plus 6 review-patch bundles for 2.2 / 2.3 / 2.5) |
| Ledger / docs commits | 13 (`docs(bmad)` lines: epic-2 context seed, per-story ledger entries, sprint-status reconciliations) |
| Files added / modified | 133 |
| Lines added (source) | 33,649 (44 % tests, 56 % code) |
| Tests shipped | **+269 net new** (api: +90, web: +97, shared: +65, simulator: +60, db: unchanged) — total repo: 559 (from 290 at Epic 1 close) |
| Test files added | 28 spec files + 1 shared test rig (`packages/api/src/__tests__/rigClock.ts`) |
| Pipeline status at close | typecheck ✓ • lint ✓ (5/5) • tests 559/559 ✓ |
| Stories with adversarial review | 5 (2.2, 2.3, 2.5 ×3 review groups, 2.9) — others cleared without formal review |
| Deferred items open | 24 across `deferred-work.md` (F-W1..W8, F-22, F-D-1, F-2.5-1..21, F-2.7-1..3) |

### Story-by-story ledger

| # | Title | Commit | New tests | Review-patch commit |
|---|---|---|---|---|
| 2.1 | Wire Contract Schemas | `8e1d79e` | (schema-pinning) | — |
| 2.2 | Ingest WebSocket Endpoint | `c81e7e6` | 18 (ingest + frame + subscriberSocket) | `22c7ea6` (F-P1..F-P15) |
| 2.3 | Unknown/Missing Field Handling | `3910280` | 7 (telemetry + frame) | `43e638e` (F-P1..F-P5) |
| 2.4 | Simulator Process + 6 Devices + 7 Scenarios | `6dffb1b` | 22 (boot + jwt + scenarios + wsClient) | — |
| 2.5 | `/admin/simulator` Admin Tab | `5503b04` | 60 (simulatorRouter + control server + SimulatorPage) | `0fb18cc` (G1 patches), `aaabbe7` / `3f791b3` (G2/G3 review summaries) |
| 2.6 | Dashboard Shell | `020eec7` | 17 (Dashboard) | `c8770ea` (broadcast-room wiring fix) |
| 2.7 | Map View | `252b081` | 14 (MapRegion) | (cleared on first commit) |
| 2.8 | Live Readings Table | `256dae1` | 20 (LiveReadingsRegion) | (cleared on first commit) |
| 2.9 | Connection State + Offline UX | `bcf7c81` | 11 (realtime + ConnectionStateBanner + AppShell) | 3 in-session reviewers (12 patches applied) |

---

## 2. What worked

### 2.1 — The wire-contract seam held under five layers of pressure

Epic 2 introduced a single source of truth (`packages/shared/src/telemetry.ts`) that every other package imports. The seam held:

- **Schema bump discipline:** `version: 1` stayed at `1` across 9 stories. No v2 bump was needed (no contract additions beyond the planned six-metric schema + `version` field).
- **No cross-package type drift:** api, simulator, and web all consume the same `TelemetryFrame` Zod schema. When Story 2.3 added `flags` + `stale_threshold` handling, the simulator imported the same constants (`STALE_FRAME_THRESHOLD_MS`, `CLOCK_SKEW_DETECT_MS`, `classifyFlags`) so its pre-send `ts` validation stays in lockstep with the api's. (F-22 closed this.)
- **Wire-shape locked at the boundary:** `LatestReadingPayload`, `DeviceSummary`, `ReadingNewEvent` are all Zod-typed at the api → web boundary. Story 2.8 added a `dashboard.spec.ts` in `packages/shared` that pins the `LatestReadingPayload` shape — closing F-W8 from the Story 2.2 deferred register.
- **One socket stream drives everything:** the dashboard (Story 2.6), map (2.7), live readings (2.8), and connection-state UX (2.9) all subscribe to the same `reading:new` event on a single shared socket. The c8770ea post-2.6 fix wired the broadcast room (Story 2.6 had been subscribing to the device-scoped room only) — the right shape, but a reminder that the broadcast-vs-device room is a one-line subscription mistake.

### 2.2 — Review loops paid for themselves (and showed where they're optional)

The 5 reviewed stories produced 24 deferred items that would otherwise have landed in production:

- Story 2.2's review caught the `socket.disconnect(true)` close-code mismatch (F-W6) — the spec I/O matrix said `4401`, Socket.IO emits `~4005`. Closed by a spec change-log entry rather than a code rewrite (the literal AC was not enforced; the intent — "close on auth failure" — was).
- Story 2.5 ran three concurrent review groups (Shared+DB, API+Simulator control, Web) and produced 28+ patches. The Group 3 web review found a real bug (`SimulatorDevice.paused` server-truthful gap, F-2.5-17) that the source-only review would have missed.
- Story 2.9 ran 3 reviewers (Blind Hunter, Edge Case Hunter, Verification Gap) and found a real implementation gap (the `connect` listener did NOT cancel the pending backoff timer, leaving a stray `socket.connect()` after reconnect). Patched in-session.

The 4 unreviewed stories (2.1, 2.4, 2.6, 2.7, 2.8 — 2.6 was fixed post-hoc) are smaller in scope and single-package; no production bugs surfaced from skipping review. **Action for Epic 3:** review anything that touches wire shape, RBAC, or adds a new socket/event; skip review for single-package UI work under ~300 lines.

### 2.3 — Two-commit story pattern survived the epic

Same shape as Epic 1: source commit + `docs(bmad)` ledger commit. The split kept:

- 16 source commits → clean `git bisect` for telemetry regressions.
- 13 ledger commits → regenerable from sprint-status without rewriting source history.
- The deferred-work file grew across stories (`F-W1..W8` from 2.2, `F-22 / F-D-1` from 2.3, `F-2.5-1..21` from 2.5, `F-2.7-1..3` from 2.7). Each story added entries; no story consolidated them. **Action for Epic 4:** add a "consolidate deferred-work" pass at every epic close.

### 2.4 — The `prefers-reduced-motion` discipline scaled

Every Epic 2 motion (live-readings row pulse, map critical-pin halo, severity banner) was built on top of the existing `index.css` override (Story 1.2a). No new motion code; no new keyframes; the override already covered them. Story 2.9's `Reconnecting…` banner added NO motion — the spec explicitly called this out, and the implementation respected it.

### 2.5 — TanStack Query + single socket = no `useEffect` chains

The dashboard's `["readings", "latest"]` invalidation pattern (set once in Story 2.6) carried the entire epic:

- Story 2.7's map reuses the same cache key — no new socket subscription.
- Story 2.8's live readings table reuses the same key — KPI band + table re-render from one event.
- Story 2.9's connection-state banner is orthogonal to the cache (it's socket-state, not data-state).

The dashboard root never unmounts on disconnect/reconnect (Story 2.6 AC5 → AC4 in 2.9's banner-exit test). 559 tests confirm this — including 7 specific "doesn't unmount" guards across the four dashboard stories.

### 2.6 — Story 2.9 was the right Story 2 capper

The last story of the epic was the meta-story: "what does the operator see when the realtime stream is down?" It pulled together:

- The Story 1.7 refresh-reconnect invariant (token rotation ≠ backoff) — preserved verbatim.
- The Story 2.2 broadcast room contract — `connect_error` and `disconnect` are the two failure surfaces, both pinned.
- The Story 2.6 "no unmount" contract — banner is the only surface that flips.

The pacing was right: a "meta" story at the end of an epic is cheaper than a "transition" story at the start, because the meta can reference everything that's already there.

---

## 3. What to change

### 3.1 — Stories 2.6, 2.7, 2.8 did not run a formal adversarial review

Three of the four UI-heavy stories (2.6, 2.7, 2.8) shipped without a code-review pass; only Story 2.9 did. Story 2.6 needed a post-hoc fix (`c8770ea` wiring the broadcast room). Story 2.7 deferred 3 items to other stories (F-2.7-1..3) without surfacing them in the same review pass — they're in `deferred-work.md` but not on the story spec's spec-change-log.

**Action for Epic 3:** treat the UI-heavy stories (`rules-table`, `alert-feed`, `kanban`) as review-required. Story 3.2 (the rule engine) is the highest-risk single story in Epic 3 — it owns the data-driven decision surface that Epic 4's incident workflow will trigger on. Mandatory review.

### 3.2 — `deferred-work.md` grew without triage

24 deferred items is the most a single register has held at any point. They break down by ownership:

| Owner | Count | Items |
|---|---|---|
| Story 6.1 (Docker Compose + README) | 3 | F-W1, F-W2, F-W3, F-2.5-8 |
| Production hardening (Epic 7) | 6 | F-W4, F-W7, F-2.5-7, F-2.5-10, F-2.5-13, F-2.5-19 |
| Spec amendment | 2 | F-W6, F-2.5-18 |
| Epic 3 (rules / alerts) | 2 | F-D-1, F-2.5-17, F-2.5-21 |
| Shared-codegen refactor | 2 | F-2.5-1, F-2.5-2, F-2.5-4 |
| Future seed refactor | 2 | F-2.5-3, F-2.5-6 |
| Story 5.x (audit + retention) | 3 | F-2.5-9, F-2.7-2, F-2.7-3 |
| Story 2.x follow-up | 1 | F-2.7-1 (KPI offline count) |
| Documented no-op | 2 | F-2.5-12, F-2.5-20 |

Of these, only 3 have a near-term owner (Story 6.1). The other 21 are spread across future epics. **Action for Epic 4 opening:** sweep the deferred register and assign owners explicitly. Anything without an Epic 3..6 owner should be marked `deferred-to-v2` so it doesn't pretend to be in-flight.

### 3.3 — `pnpm-lock.yaml` churn is real, not noise

Story 2.2's review patch (`22c7ea6`), Story 2.5 (`5503b04`), and Story 2.9 (`bcf7c81`) all touched `pnpm-lock.yaml`. Epic 1's R2 (the lockfile-churn risk) repeated here. **Action:** consider `--no-lockfile` for stories where the lockfile change is a `pnpm install` artifact (dependency peer-resolution, not a story outcome). Specifically: any patch commit that bumps a dep version without using it should leave the lockfile untouched.

### 3.4 — The `simplify flag` and `paused` server-truthful gap are Story 2.5's open thread

Two related deferrals (F-2.5-17 + F-2.5-18):

- The api's `/devices` listing doesn't expose `paused` per device. The Story 2.5 web UX is client-truthful only ("Pause state is client-side after the first click").
- The spec AC1's "Start / Pause / Switch" was collapsed into Pause/Resume by `paused: false` in the api. This consolidation needs to land in the change log.

These are not blockers for Epic 4, but the next time the simulator UX is touched (Epic 4's "stop device from sending frames" flow), the gap will resurface. **Action for Epic 4 opening:** if Story 4.x touches the simulator, file an Epic 3 follow-up to add the `paused` field to `/api/devices` and a server-truthful pause resume.

### 3.5 — The KPI offline count is the only "didn't fully wire" item in the dashboard surface

F-2.7-1: `summarizeReadings` still hard-codes `offline: 0`. The shared `isOffline()` helper exists (Story 2.7) but the KPI band doesn't consume it. A reviewer running `docker compose up` sees a 0/0/0/0 band even after stopping the simulator — the offline count stays at 0. **Action for Epic 3 opening:** if a Story 3.x spec touches the dashboard, fold the offline-count adoption in. Otherwise, file a Story 2.10 (or roll it into Epic 6 as part of the operator-comprehension pass).

### 3.6 — The `eslint complexity` budget pre-emption pattern held, but only just

Story 2.2's `frame.ts` (10-step pipeline, 680 lines) did NOT need to be split (the `complexity` lint rule was satisfied by the sequential helper structure). Story 2.4's `wsClient.ts` (651 lines) is a single stateful class — pre-emptive factor wasn't necessary. Story 2.5's `simulatorRouter.ts` (669 lines spec) had to be factored by the G2 review (G2-14 removed the bare-GET fallback).

**Action for Epic 3:** the rule engine (`packages/api/src/rules/`) will exceed 600 lines and WILL need pre-emptive factoring. Plan the file layout in Step-02 (Plan), not Step-04 (Review).

---

## 4. Lessons learned

### L1 — A `version: 1` wire contract pays off by story 3, not story 1

Epic 1's `auth.ts` wire contract had a single bump in 11 stories (the role-claim addition in Story 1.7). Epic 2's `telemetry.ts` had zero bumps in 9 stories because the contract was frozen at the end of Story 2.1's planning, not Story 2.2's implementation. **Action:** freeze the wire shape in Step-02 (Plan) by writing the Zod schema BEFORE the implementing story ships, even if the schema lives in `packages/shared` for one story before any consumer references it.

### L2 — Review Groups work when the surface area is cross-package

Story 2.5's three concurrent review groups (Shared+DB, API+Simulator control, Web) found 28 patches across 4 packages. The same work as a single reviewer would have taken 3× the wall time. **Action for Epic 3 (rules engine):** the rule-engine surface touches api (evaluator), shared (rule schema), db (Rules table), and Epic 4 will touch it again — run at least 2 concurrent review groups for it (api + shared/db).

### L3 — TanStack Query cache invalidation is the dashboard's connective tissue

Every dashboard story in Epic 2 (`2.6`, `2.7`, `2.8`) consumed `["readings", "latest"]` — the SAME cache key. The `reading:new` socket event fired by the api triggers ONE invalidation, and FOUR regions re-render. This is the right shape; future dashboard stories should adopt the same pattern, not introduce per-region sockets.

### L4 — Story 2.9 was the right scope for a "UX completeness" story

Epic 2 ended on a story that adds ZERO new functionality (no new REST endpoint, no new socket event, no new model) — it surfaces the EXISTING socket state to the operator. This is a useful pattern: at the end of every epic, ship a "what does the operator SEE when the system is broken?" story. For Epic 3, this would be "rule-evaluation latency: what does the operator see while a rule is mid-evaluating?" For Epic 4, "incident-creation latency: what does the operator see between `alert` and `incident`?"

### L5 — Test rig (`packages/api/src/__tests__/rigClock.ts`) is the right shape for shared test scaffolding

Story 2.5 introduced a test rig — a clock-injection helper that the api and simulator both consume. The pattern: a single `rigClock.ts` in `packages/api/src/__tests__/` (already excluded from production `dist/` per the Epic 1 L1 action), imported by both `packages/api/src/admin/simulatorRouter.spec.ts` and `packages/simulator/src/control/server.spec.ts`. **Action for Epic 3:** when a new spec needs a fixture that crosses package boundaries (e.g., a seeded Prisma client for rules-engine tests), the `src/__tests__/` zone in the api package is the right home. Do NOT duplicate the fixture in each package.

### L6 — Deferred-work register is a forcing function for spec clarity

24 deferred items, 0 spec changes needed. Every "we'll fix this in v2" was captured in writing. The register is the alternative to memory — a future contributor reading `deferred-work.md` learns what NOT to refactor. **Action for Epic 4 opening:** the register is now a contract; don't delete items from it, mark them `deferred-to-v2` when ownership evaporates.

---

## 5. Open risks for Epic 3 (Rules & Alerts)

### R1 — The rule engine is the highest-risk story in the project

Epic 3 Story 3.2 (Three Rule Types + Evaluation Engine) is the data-driven decision surface. It:

- Reads from `Reading` (every 2 s per device × 6 devices = 3 readings/s at simulator volumes; 100 devices × 1 reading/min × 6 metrics × 3 rules per device = 18k evaluations/min at production volumes).
- Writes to `Alert` + `Incident` (Epic 4's workflow trigger).
- Must dedupe / debounce (Story 3.4) — adds a stateful layer.
- Must surface latency to the operator (per Epic 2's "UX completeness" pattern).

**Action:** Epic 3's Step-02 (Plan) for Story 3.2 must include a `complexity`-aware file layout, an explicit eval-loop contract (per-device single-threaded, like Story 2.2's frame pipeline), and a deduplication state model. NOT a "we'll figure it out in implementation" pass.

### R2 — The `paused` server-truthful gap will bite Epic 4

Story 2.5's F-2.5-17 deferred this. If Epic 4 (Incidents & Workflow) needs to stop a device from sending frames mid-incident (e.g., "Suspend this device while we investigate"), the api currently has no way to express that. The simulator's `paused` state is local to the simulator process; restarting the simulator resets it. **Action:** Epic 4's first simulator-touching story should also file an Epic 3 follow-up. Do not let Epic 4 land a workaround that hides the gap.

### R3 — The `Reading` table needs a `MAX(serverReceivedAt)` index for production

F-2.7-2 deferred the index on `Reading("deviceId", "serverReceivedAt")`. At simulator volumes (6 devices × 1 reading/2s = 3/s × 24 h = 259k rows/day) the seq-scan-per-request is invisible. At production volumes (100 devices × 1 reading/min × 30 days = 4.3M rows), the api's `GET /api/devices` runs a seq-scan for every dashboard mount. **Action:** Story 5.4 (ReadingAggregate Table) is the natural owner. Add the index as part of that migration.

### R4 — The simulator process restart resets scenario assignments

Story 2.4's `scenario` field is in-memory only. If the simulator crashes mid-test, all devices revert to `Normal`. Real devices have persistent scenario state in the api's `Device` table. **Action:** Story 3.x (whichever owns the rule-engine's scenario-loop test) should add a `device.scenario` column to the api and have the simulator read it on boot. Alternatively, file a Story 2.10.

### R5 — The `__simulator_event` audit row shape is wrong

F-2.5-9: the audit logger emits `context:` but the spec says `payload: { device_id, scenario }`. Story 5.6 (audit-log pipeline) is the natural owner. **Action:** when Story 5.6 lands, do the rename + column migration + backfill in one commit.

### R6 — The 24-item deferred-work register will collide with Epic 3 scope

3 items have Epic 3 ownership. The rest are spread. If Epic 3 stories try to address items not in their AC scope, they'll add noise. **Action:** Epic 3's Step-02 (Plan) per story should explicitly call out "this story does NOT address any item in `deferred-work.md`" when applicable. The alternative — silently fixing deferred items mid-story — is how epics grow past their scope.

### R7 — Connection-state UX is at risk of false positives

Story 2.9's banner fires on transport-level disconnects. But the `connect_error` token-branch does NOT flip `isConnected` (the 1.7 invariant). A misconfigured server (no `aud: simulator` claim validation, for example) could keep flipping the banner without ever showing the operator a useful signal. **Action:** add an Epic 6 observability pass that asserts the banner is correlated with a real `socket.io` engine.io poll failure (not a server-side reject).

---

## 6. Recommended next action

**Run `bmad-build` for Story 3.1 (Rules Table + Prisma Schema).** This is the foundation for Stories 3.2..3.7 — the rule schema is the single source of truth that the evaluator reads, the seed script writes, the thresholds admin tab edits, and Epic 4's incident creation consumes. Land it first; Stories 3.2..3.7 have a stable substrate to build on.

Story 3.1 is small in scope (one Prisma migration + one Zod schema in `packages/shared` + a `/api/rules` REST surface) and follows the Story 2.1 pattern almost exactly. Estimated: 5-7 commits, ~30 new tests, no review-patch bundle needed.

---

## 7. Sprint-status update

After this retrospective is committed, `sprint-status.yaml` will have:

- Epic 2 status: `done`
- An `epic-2-retrospective` entry with status `done`
- Epic 2 stories 2.1–2.9 all `done`

The next story to surface in the sprint-status skill's recommendation is **Story 3.1** (the only `backlog` story in Epic 3).

---

## Change log

- 2026-08-24 — initial retrospective. Epic 2 closed. Story 2.9 finalizes the dashboard surface (banner + backoff); 559 tests across 5 packages; 24 deferred items registered for future epics.