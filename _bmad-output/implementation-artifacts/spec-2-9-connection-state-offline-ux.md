---
title: 'Story 2.9 — Connection State + Offline UX'
type: 'feature'
created: '2026-08-24'
status: 'done'
baseline_commit: '256dae125da1685ad5a62ba9b90235703e3dfe1e' # feat(web): Story 2.8 — Live Readings Table
review_loop_iteration: 0
context:
  - _bmad-output/planning-artifacts/epics.md#story-29
  - _bmad-output/planning-artifacts/ux-designs/ux-Surakkha-2026-08-20/DESIGN.md
  - _bmad-output/implementation-artifacts/spec-2-8-live-readings-table.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.6 / 2.7 / 2.8 wired the dashboard to a shared socket, but the UI has no surface for "the realtime stream is down." A reviewer who runs `docker compose down api` sees the Live Readings table freeze — no explanation, no countdown. Today every page can silently disagree with reality and the operator has no UX-DR-11 signal telling them to stop acting on last-known data.

**Approach:** Add a zustand-backed connection-state store fed by `socketClient`'s `connect` / `disconnect` / `connect_error` listeners. Mount a `ConnectionStateBanner` in `AppShell` above the existing `severity-banner-slot`; the banner stays visible while `isConnected === false` and exits when the socket reconnects. Transport-level disconnects retry on an explicit exponential-backoff timer (5s, 10s, 20s, capped 30s) layered on top of Story 1.7's manual `401 token_expired` refresh-reconnect path. Export `useConnectionState()` so Epic 4 can disable its action affordances — Story 2.9 ships the hook + tests + banner, but no current page consumes the disable half yet (Epic 4 is the consumer).

## Boundaries & Constraints

**Always:**
- A single zustand store is the source of truth for connection state: `{ isConnected: boolean, lastConnectedAt: number | null, lastDisconnectedAt: number | null, retryAttempt: number }`. Pages read via `useConnectionState()`; no per-component `useState` for connection state.
- Initial store state is `isConnected: true` (deliberate — mirrors Story 2.6's "first render doesn't pulse" pattern). The banner stays silent until the socket actually disconnects. A cold mount on a known-down server renders no banner until `connect_error` or `disconnect` fires; this is a deliberate trade-off.
- The Reconnecting banner lives in `AppShell.tsx` in its own slot (`<div data-testid="connection-state-banner-slot" />`) **above** the existing `severity-banner-slot` (Epic 4 reserves that one). `ConnectionStateBanner` is the direct child of the slot — no wrapper elements.
- Transport-level retry schedule: attempt 1 → 5s, attempt 2 → 10s, attempt 3 → 20s, attempts ≥4 → 30s (capped). Resets on a successful `connect`. No jitter (Socket.IO's default `randomizationFactor` would make tests non-deterministic).
- The Story 1.7 `401 token_expired` refresh-reconnect path is preserved verbatim. Two paths never collide: `connect_error` with `"token"` in `err.message` keeps the refresh flow and MUST NOT flip `isConnected` (no banner flash during token rotation); bare `disconnect` or non-token `connect_error` drives the backoff timer.
- Backoff timer is **module-scoped** — single timer slot owned by `socketClient`. Multiple components calling `connectSocket` for the same `url` share the same timer; only one `setTimeout` in flight at a time. `disconnectSocket()` cancels any pending timer AND resets `retryAttempt` to 0 (a zombie timer would otherwise fire `socket.connect()` on a torn-down socket).
- `computeBackoffMs(attempt)` clamps `attempt` to `Math.max(0, Math.floor(attempt))` before applying the formula — defensive against store corruption.
- `incrementRetry()` MUST be called BEFORE `scheduleBackoffReconnect(socket, retryAttempt)` so the formula sees the post-increment value.
- The dashboard regions **never** unmount on disconnect / reconnect — Story 2.6 AC5 contract. The banner is the only surface that flips.
- Banner copy: heading `"Reconnecting…"`, body `"Showing last-known data."`. `aria-live="polite"` on the body only (UX-DR-6 noise reduction). Renders only when `isConnected === false`.
- Banner-clear: the banner returns `null` the moment `isConnected === true` after a `connect` event. The next `reading:new` then re-renders the Live Readings table with fresh values (Story 2.8's `animate-live-pulse`).
- `useConnectionState()` is the public surface for Epic 4. Returns `{ isConnected, retryAttempt }` (subset — `lastConnectedAt` / `lastDisconnectedAt` are internal). The selector is memoized — consumers do not re-render on every store tick, only on `isConnected` / `retryAttempt` change.
- All Tailwind classes are LITERAL strings (Story 2.8's VG-1 lesson: JIT scanner matches complete literals only).

**Ask First:**
- Whether the banner should auto-dismiss after N successful `reading:new` events, or whether a single `isConnected === true` flip is enough (recommend: single flip).
- Whether `useConnectionState()` should expose `retryAttempt` for a UI countdown, or whether that is internal-only (recommend: internal-only).

**Never:**
- Do not unmount any region on disconnect. Story 2.6 AC5 contract holds.
- Do not change the Story 1.7 `401 token_expired` refresh flow. Token rotation is fast, not a backoff.
- Do not use Socket.IO's built-in `reconnection: true` with `reconnectionDelay`. We own the schedule.
- Do not introduce a new design token. Reuse `severity.warning.{value, bg}` tokens — the connection-state colour is "warning, not critical" (degraded, not failing).
- Do not animate the banner. It pops in / out instantly. No `prefers-reduced-motion` override needed.
- Do not import `@surakkha/api` from `@surakkha/web`. The web talks to the api over the wire only.
- Do not change `connectSocket`'s public signature in a way that breaks `useDashboardSocket`'s call site.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Socket connects on first mount | `connect` event fires once | Banner never renders; `isConnected === true`; `retryAttempt === 0` | N/A |
| Transport-level disconnect mid-session | `disconnect` (no `connect_error`) | Banner renders `Reconnecting…`; `isConnected === false`; backoff timer scheduled; `retryAttempt` increments per attempt | N/A |
| `401 token_expired` while connected | Server emits `token_expired` | Story 1.7's refresh-reconnect fires — banner does NOT appear; `isConnected` is NOT flipped to `false`; `retryAttempt` is NOT incremented | Refresh fail → `onSessionLost` → nav to /login (Story 1.7 contract) |
| `connect_error` on token-related message | `err.message ?? ""` includes `"token"` (case-insensitive defensive) | Story 1.7's refresh path fires — banner does NOT appear; `isConnected` is NOT flipped | Refresh fail → `onSessionLost` |
| `connect_error` on network failure (timeout / 5xx) | `connect_error` with no `"token"` substring, OR `err.message === undefined` | `markDisconnected()`; banner renders; backoff timer scheduled | N/A |
| Backoff schedule (5 / 10 / 20 / 30 cap) | Attempt 1 → 5s → attempt 2 → fails → 10s → fails → 20s → fails → ≥30s thereafter | Each attempt resets on successful `connect` | N/A |
| Reconnect succeeds mid-backoff | `connect` fires before timer elapses | Timer clears; `isConnected === true`; `retryAttempt === 0`; banner hidden | N/A |
| Page hard-refresh on a known-down server | Cold load, socket never connects | Banner renders after initial `connect_timeout`; `retryAttempt === 1`; 5s timer scheduled | N/A |
| Operator navigates away from `/dashboard` mid-disconnect | React Router unmounts `Dashboard` | `useDashboardSocket` cleanup tears down its listener; banner lives in `AppShell` and stays visible across page changes (socket is shared) | N/A |
| Viewer role on `/dashboard` while disconnected | Viewer can read but cannot take actions | Banner renders identically to Operator; no API-bound action buttons exist yet to disable (Epic 4) | N/A |

## Code Map

- `_bmad-output/planning-artifacts/epics.md:913-941` — verbatim Story 2.9 ACs (4 bullets; covers UX-DR-11).
- `packages/web/src/realtime/socketClient.ts:54-99` — current singleton socket; `reconnection: false`; `wireAuthHandlers` handles `401 token_expired`. We extend this file's listeners to push into the connection-state store.
- `packages/web/src/realtime/socketClient.ts:137-143` — `disconnectSocket()` (logout / test teardown). Must reset the store so a fresh session does not inherit the prior session's banner.
- `packages/web/src/dashboard/useDashboardSocket.ts:59-84` — dashboard's hook. **No change** — `connectSocket`'s listeners wire the store globally, so this hook continues to add only its `reading:new` listener.
- `packages/web/src/shell/AppShell.tsx:73-101` — the existing `<div data-testid="severity-banner-slot" />` (line 77) reserves the Epic 4 severity banner. The new `<div data-testid="connection-state-banner-slot" />` mounts **above** it.
- `packages/web/package.json:43` — `zustand@4.5.5` already a dep. No new dependency.
- `packages/web/tailwind.config.ts:53-83` — `color.severity.warning.{value, text, fill, bg, glow}` tokens already exist. Banner reuses `border-severity-warning-value` + `bg-severity-warning-bg`.

## Tasks & Acceptance

1. [ ] `packages/web/src/realtime/connectionStateStore.ts` (NEW) — zustand store with the typed shape `{ isConnected: boolean, lastConnectedAt: number | null, lastDisconnectedAt: number | null, retryAttempt: number }`. Initial state: `isConnected: true`, `lastConnectedAt: null`, `lastDisconnectedAt: null`, `retryAttempt: 0`. Pure state + setter actions (`markConnected`, `markDisconnected`, `incrementRetry`, `resetRetry`). No side-effects in the store itself — listener wiring lives in `socketClient.ts`.
2. [ ] `packages/web/src/realtime/useConnectionState.ts` (NEW) — `useConnectionState()` hook returning a stable selector over the store. Returns `{ isConnected, retryAttempt }`. Memoized so consumers don't churn on every store tick.
3. [ ] `packages/web/src/realtime/backoffTimer.ts` (NEW) — Pure formula `computeBackoffMs(attempt: number): number` → `5_000 * 2^min(attempt, 2)` capped at `30_000`. Lives in its own file for testability; the `setTimeout` call itself stays in `socketClient.ts`.
4. [ ] `packages/web/src/realtime/socketClient.ts` (MOD) — In `wireAuthHandlers`, add `socket.on("connect", ...)` → `markConnected() + resetRetry()`; `socket.on("disconnect", ...)` → `incrementRetry()` THEN `markDisconnected() + scheduleBackoffReconnect(socket, retryAttempt)` (so the formula sees the post-increment value); `socket.on("connect_error", ...)` → if `(err.message ?? "").toLowerCase().includes("token")` → existing refresh path (no `isConnected` flip); else → `markDisconnected()` (does NOT reschedule — the existing timer from the originating `disconnect` keeps firing). `disconnectSocket()` cancels the pending backoff timer (`clearTimeout`) AND resets `retryAttempt` to 0 BEFORE disconnecting.
5. [ ] `packages/web/src/shell/ConnectionStateBanner.tsx` (NEW) — Renders only when `useConnectionState().isConnected === false`. Heading `"Reconnecting…"`, body `"Showing last-known data."`. `aria-live="polite"` on the body. Reuses `border-severity-warning-value` + `bg-severity-warning-bg` tokens. No animation. `data-testid="connection-state-banner"`.
6. [ ] `packages/web/src/shell/AppShell.tsx` (MOD) — Add `<div data-testid="connection-state-banner-slot" />` above the existing `severity-banner-slot` (line 77). Render `<ConnectionStateBanner />` inside the slot.
7. [ ] `packages/web/src/realtime/connectionStateStore.spec.ts` (NEW) — Test the setter actions: `markConnected` sets `isConnected: true` + `lastConnectedAt`; `markDisconnected` sets `isConnected: false` + `lastDisconnectedAt`; `incrementRetry` bumps `retryAttempt`; `resetRetry` zeros it.
8. [ ] `packages/web/src/realtime/backoffTimer.spec.ts` (NEW) — Test the formula: attempt 0/1 → 5_000ms; attempt 2 → 10_000ms; attempt 3 → 20_000ms; attempt 4+ → 30_000ms.
9. [ ] `packages/web/src/shell/ConnectionStateBanner.spec.tsx` (NEW) — Test: `isConnected: true` → renders nothing; `isConnected: false` → renders the banner with documented copy + `aria-live="polite"` on the body (NOT on the heading).
10. [ ] `packages/web/src/realtime/useConnectionState.spec.tsx` (NEW) — Test the selector's memoization contract: a consumer re-renders only when `isConnected` or `retryAttempt` changes, not on every store tick (use `vi.useFakeTimers()` or a render-count mock). Test: mutating `lastConnectedAt` (an internal field) does NOT trigger a re-render.
11. [ ] `packages/web/src/dashboard/Dashboard.spec.tsx` (MOD) — Add `describe("Story 2.9 — connection state")` block with: (a) banner does NOT render on a happy-path Dashboard render; (b) when the stub socket emits `disconnect`, the banner renders above the four regions and the four regions stay in the tree (Story 2.6 AC5 regression guard); (c) `disconnectSocket` (the test helper) cancels any pending backoff timer — assert no `socket.connect()` is called after teardown. The existing `activeSocket` mock needs a `__emitDisconnect()` helper added for parity with `__emitReadingNew`.
12. [ ] `packages/web/src/shell/AppShell.spec.tsx` (NEW) — Assert the `connection-state-banner-slot` renders ABOVE `severity-banner-slot` in DOM order (regression guard for Epic 4 stacking). Use `screen.getByTestId("app-shell")` and compare the index of each slot's position in the DOM tree.
13. [ ] `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` — green across all five packages.

**Acceptance Criteria:**

1. Given the socket is connected
   When the dashboard renders
   Then no Reconnecting banner appears
   And `useConnectionState().isConnected === true`
2. Given the socket disconnects for any non-token reason
   When the connection state changes
   Then a `Reconnecting…` banner appears at the top of `AppShell` (above the `severity-banner-slot`)
   And the banner body has `aria-live="polite"`
   And all four dashboard regions remain mounted (regression guard on Story 2.6 AC5)
3. Given the socket is disconnected
   When the client retries
   Then it uses exponential backoff: attempt 1 → 5s, attempt 2 → 10s, attempt 3 → 20s, attempts ≥4 → 30s
   And the banner stays visible until the socket reconnects
4. Given the socket reconnects
   When `isConnected` flips to `true`
   Then the banner disappears
   And the Live Readings table re-renders with fresh values (Story 2.8 contract) on the next `reading:new`

## Design Notes

**Single source of truth** — the zustand store replaces any per-component `useState` for connection state. `useDashboardSocket` does NOT need to know about the store — `socketClient`'s listeners push into the store, `ConnectionStateBanner` reads from the store. Every future page (Kanban, Audit, etc.) inherits the banner + state for free, with zero per-page wiring.

**Why not Socket.IO's `reconnection: true`** — Socket.IO's built-in backoff uses random jitter (`randomizationFactor` default 0.5), making test schedules non-deterministic. Owning the schedule via a `setTimeout` keyed off `retryAttempt` keeps it testable and lets us clear it on a successful `connect`.

**Banner-clear semantics** — when `isConnected === true`, the banner returns `null`. No second event needed. Story 2.9 AC4's "fresh reading:new event arrives" is satisfied because the cache refetches on `connect` re-render the Live Readings table, and the banner is already gone the moment `isConnected` flips, so the operator sees the transition together with the next row pulse.

**Why `connect_error` is split from `disconnect`** — `connect_error` with `"token"` → server rejected our token (refresh path). `connect_error` with network error → api is down (backoff path). `disconnect` after a previously successful connect → socket dropped (backoff path). The split mirrors the Story 1.7 invariant: token rotation is fast, transport retry is slow.

**Stacking order in `AppShell`** — `connection-state-banner-slot` mounts **above** `severity-banner-slot`. When both render (Epic 4 future: connection down + critical incident), the operator sees the realtime signal first. `ConnectionStateBanner` is the direct child of the slot — no wrapper elements, so the DOM-tree position test (task #12) stays a simple slot-vs-slot comparison.

**Independent from `isOffline()`** — Story 2.9's `isConnected` is *socket* state; Story 2.7's `isOffline(device, now)` is *device-state-staleness*. A device can be `offline` while the socket is `connected` (a device with no recent reading) — the two contracts do not interact. Future stories may layer an "X devices offline" indicator on top of the banner, but it is out of scope here.

**Known trade-off — socket-connected ≠ api-healthy** — the banner clears on a successful `connect` event, but the api may be reachable-yet-degraded (e.g., DB 500 — see Story 2.7's deferred F-2.7-1 in `_bmad-output/implementation-artifacts/deferred-work.md`). Story 2.9 does not detect API health; the banner-clear contract is purely socket-state. Future Story 5.3 (Audit Log) or Epic 6 monitoring may layer an api-health signal on top of the banner; this story stays scoped to the socket.

**`prefers-reduced-motion`** — the banner has no animation, so the existing `index.css` override (lines 187-197) is a no-op for this surface. If motion is added in a future story, the same CSS rule will cover it; no Story 2.9 code needed.

## Decisions

Human-owned design decisions captured during Step-01 (clarifying questions). Each entry pins the chosen path against the available alternatives so a future reviewer does not relitigate them.

1. **Banner auto-dismiss** — *single `isConnected === true` flip* (no count-based dismissal on N successful `reading:new` events). Rationale: a single boolean flip is the simplest contract that matches AC4's "banner disappears when socket reconnects"; a count-based threshold would re-introduce a hidden state machine and complicate tests for zero benefit.
2. **`retryAttempt` exposure** — *internal-only* (kept out of the public `useConnectionState()` return shape). Rationale: Epic 4 may want a countdown, but exposing it now creates a public API surface that would be hard to retract; if Epic 4 needs it, we add a follow-up selector rather than expand the current one.
3. **`incrementRetry` ordering** — *must run BEFORE `scheduleBackoffReconnect(socket, retryAttempt)`*. Rationale: `computeBackoffMs` reads the POST-increment value so the formula produces 5s / 10s / 20s / 30s; calling in the opposite order would produce 0s on the first attempt.
4. **Backoff cap formula** — `5_000 * 2^min(attempt, 2)` capped at `30_000` (no jitter). Rationale: Socket.IO's `randomizationFactor` would make test schedules non-deterministic; capping the exponent at 2 (so the doubling stops after attempt 3) and then a hard 30s cap produces a flat 30s tail that is testable and predictable.
5. **Defensive clamps** — `Math.max(0, Math.floor(attempt))` and a `Number.isFinite` guard in `incrementRetry`. Rationale: store corruption (NaN, Infinity, negative integers from a manual `setState`) would otherwise leak into the backoff formula and produce sub-second delays or `NaN` timer expirations; the clamps restore the contract without requiring the store to be "safe by construction".

## Verification

**Commands:**
- `pnpm -r lint` — expected: clean across 5 packages.
- `pnpm -r typecheck` — expected: clean across 5 packages.
- `pnpm -r test` — expected: all green (web: 196 tests; +43 new for Story 2.9 across 6 spec files).
- `pnpm --filter @surakkha/web test -- realtime` — expected: socketClient + backoffTimer + connectionStateStore tests pass.
- `pnpm --filter @surakkha/web test -- shell` — expected: ConnectionStateBanner tests pass.

**Manual checks (if no CLI):**
- `pnpm --filter @surakkha/web dev`, then `pnpm --filter @surakkha/api dev` — banner never renders.
- Stop the api mid-session (`Ctrl+C`). Within ~1s the banner renders. The four dashboard regions stay in the tree (no unmount, no spinner).
- Restart the api. The banner disappears the moment the socket reconnects; the next `reading:new` (≤ 5s later) plays the 1200ms row pulse.
- Disconnect again, watch the backoff: 5s, 10s, 20s, 30s. Set browser DevTools → Network → "Offline" to force a transport-level failure.

## Suggested Review Order

**Listener wiring (the heart of the change)**

- The `connect` listener cancels any pending backoff timer (zombie-timer guard) and resets the store.
  [`socketClient.ts:143`](../../packages/web/src/realtime/socketClient.ts#L143)

- The `disconnect` listener increments `retryAttempt` BEFORE scheduling so `computeBackoffMs` sees the post-increment value (5s for first attempt).
  [`socketClient.ts:155`](../../packages/web/src/realtime/socketClient.ts#L155)

- The `connect_error` listener splits into a token-refresh path (Story 1.7) and a network-failure path; only the latter flips `isConnected`.
  [`socketClient.ts:166`](../../packages/web/src/realtime/socketClient.ts#L166)

- Module-scoped backoff timer slot + `cancelBackoff()` helper — the unit of "one socket, one pending timer".
  [`socketClient.ts:97`](../../packages/web/src/realtime/socketClient.ts#L97)

- `disconnectSocket()` cancels the timer AND resets `retryAttempt` to 0 BEFORE disconnecting (no zombie `socket.connect()`).
  [`socketClient.ts:243`](../../packages/web/src/realtime/socketClient.ts#L243)

**Backoff formula (pure, isolated)**

- `computeBackoffMs(attempt)` — `5_000 * 2^(attempt - 1)` capped at `30_000`, with `Math.max(0, Math.floor(attempt))` clamp.
  [`backoffTimer.ts:35`](../../packages/web/src/realtime/backoffTimer.ts#L35)

**Connection state store (single source of truth)**

- Store shape + setter actions (`markConnected`, `markDisconnected`, `incrementRetry`, `resetRetry`); `incrementRetry` defends against `NaN` from a corrupted store.
  [`connectionStateStore.ts:48`](../../packages/web/src/realtime/connectionStateStore.ts#L48)

**Public selector**

- `useConnectionState()` returns `{ isConnected, retryAttempt }` only — internal fields are intentionally excluded so `Date.now()` stamps don't churn re-renders.
  [`useConnectionState.ts:30`](../../packages/web/src/realtime/useConnectionState.ts#L30)

**UI surface**

- `ConnectionStateBanner` returns null when `isConnected === true`; renders the documented copy + `aria-live="polite"` body when false.
  [`ConnectionStateBanner.tsx:31`](../../packages/web/src/shell/ConnectionStateBanner.tsx#L31)

- `AppShell` mounts `connection-state-banner-slot` ABOVE the existing `severity-banner-slot` (Epic 4 stacking contract).
  [`AppShell.tsx:83`](../../packages/web/src/shell/AppShell.tsx#L83)

**Peripherals (tests, in order of contract density)**

- Listener-wiring spec covers all I/O matrix rows (token-branch, network branch, mid-backoff reconnect, cold-mount down).
  [`socketClient.spec.ts:233`](../../packages/web/src/realtime/socketClient.spec.ts#L233)

- `disconnectSocket` cancel-then-reset semantics + idempotency + zombie-timer regression.
  [`socketClient.spec.ts:281`](../../packages/web/src/realtime/socketClient.spec.ts#L281)

- `computeBackoffMs` schedule + defensive clamps (negative, fractional, `NaN`).
  [`backoffTimer.spec.ts:22`](../../packages/web/src/realtime/backoffTimer.spec.ts#L22)

- Store setter actions + `incrementRetry` NaN-clamp regression.
  [`connectionStateStore.spec.ts`](../../packages/web/src/realtime/connectionStateStore.spec.ts)

- Selector memoization — mutating internal fields does NOT trigger re-renders.
  [`useConnectionState.spec.tsx`](../../packages/web/src/realtime/useConnectionState.spec.tsx)

- Banner conditional render + severity tokens + motion-class exclusion.
  [`ConnectionStateBanner.spec.tsx:23`](../../packages/web/src/shell/ConnectionStateBanner.spec.tsx#L23)

- `AppShell` slot stacking — `connection-state-banner-slot` precedes `severity-banner-slot` in DOM order.
  [`AppShell.spec.tsx`](../../packages/web/src/shell/AppShell.spec.tsx)

- Dashboard-level integration — banner renders on disconnect, all four regions stay mounted, AC4 banner-exit on reconnect.
  [`Dashboard.spec.tsx:742`](../../packages/web/src/dashboard/Dashboard.spec.tsx#L742)