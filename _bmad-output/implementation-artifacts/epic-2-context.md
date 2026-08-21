# Epic 2 Context: Devices & Telemetry

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A reviewer can launch the docker-compose stack, log in, and see six devices on the map and live readings in the table updating at the configured rate, with no manual setup beyond `docker compose up` and the 5-minute README. This epic establishes the wire-contract seam that every later epic builds on: devices and the simulator authenticate and stream frames over the same WebSocket contract, the api validates and persists them through a deterministic per-device pipeline, and the dashboard shell, map, live readings table, and connection-state UX are all wired to that single socket stream so the demo story begins here.

## Stories

- Story 2.1: Wire Contract Schemas
- Story 2.2: Ingest WebSocket Endpoint
- Story 2.3: Unknown/Missing Field Handling
- Story 2.4: Simulator Process + Six Default Devices + Seven Scenarios
- Story 2.5: `/admin/simulator` Admin Tab
- Story 2.6: Dashboard Shell
- Story 2.7: Map View
- Story 2.8: Live Readings Table
- Story 2.9: Connection State + Offline UX

## Requirements & Constraints

Devices and the simulator each carry a stable UUIDv4 `device_id`; the simulator takes the place of real hardware behind the same wire contract, never a back-door. Every telemetry frame is versioned (`version: 1`) and carries `device_id`, device-local `ts`, `fw`, a monotonically increasing per-device `seq`, and a six-metric object (`ph`, `tds_ppm`, `turbidity_ntu`, `temp_c`, `chlorine_ppm`, `water_level_cm`) with type and range guards derived from BRD defaults. The server stamps its own `server_received_at` as the canonical "seen at" timestamp and never trusts device clocks for ordering.

Authentication is by short-lived per-device JWT carried at the transport layer, not in the frame: the JWT carries `iss: surakkha-api`, `aud: device|simulator`, `scope`, and `sub` (the device UUID), and the connection closes with `4401` if the `sub` does not match the URL path. The simulator's JWT is rotated on every boot and carries `aud: simulator` with `scope: telemetry:write`; it must NOT carry any admin scope. The simulator is a separate Node process on the same wire contract.

The server enforces a per-device rate cap of one accepted reading per 2 seconds; over-cap frames are rejected with `429` and a `Retry-After` header. `seq` is enforced monotonically per device: `seq ≤ last_seen` is still persisted (as a `seq_reorder` outcome for metrics) so no reading is silently dropped, only gaps are recorded as `seq_drop`. Frames with `ts` more than 24 hours in the past are rejected as `stale_frame`; future skew is accepted but surfaced as a `clock_skew_seconds` operational metric. Schema validation rejects missing required fields with `{ error: "missing_required_field", missing_fields: [...] }` and silently strips unknown fields for forward-compatibility.

Defaults (six devices, one per seeded school, each with a stable UUIDv4 and a default scenario assignment) are seeded by the executable `prisma/seed.ts`; the server never computes defaults at runtime. Seven scenarios are supported: `Normal`, `RisingTDS`, `TurbiditySpike`, `ChlorineDrop`, `Offline`, `BatteryLow`, `RandomFailure`. The simulator must buffer up to 5,000 readings in memory during disconnects and flush them in `seq` order on reconnect, honoring `Retry-After` rather than dropping on a 429.

## Technical Decisions

The platform is a monorepo with `packages/shared`, `packages/api`, `packages/db`, `packages/simulator`, and a frontend package; one Node process runs api + ingestion + rules + alerts + workflow + cron, with the simulator split out as a separate process that connects as a real device. The shared package is the single source of truth for the wire contract: Zod schemas for the telemetry frame, JWT claims, metric types, and metric ranges, with a `safeParse` path that the api translates into `400 bad_request` responses. A contract bump is a single-file edit in `packages/shared`.

The server processes each frame in a deterministic, single-threaded-per-device order: validate → auth check → rate check → seq/drop check → persist → rule evaluation → alert emission → state-machine update → audit append → socket broadcast. The api broadcasts accepted frames on the Socket.IO room `device:<device_id>` as `reading:new` events; the web client subscribes to the same stream so the dashboard, map, and live readings table all react to one source.

The `Reading` row carries `flags` (a small enum covering `out_of_order`, `clock_skew_detected`, `rate_limited`) for ops views and indexes on `(device_id, seq DESC)` for replay and dedup. ESLint/Prettier and shared Zod schemas ensure the api and simulator cannot drift on the contract. Simulator reconnects use exponential backoff `1s → 2s → 4s → … → 30s`; web-client reconnects use `5s → 10s → 20s → … → 30s`. There is no per-frame cryptographic signing in v1; per-device JWT auth is sufficient. Wire-contract additions in v2 must bump `version` and add a v2-bump justification to any PR.

## UX & Interaction Patterns

The dashboard shell renders four regions in fixed DOM order for screen-reader reach: KPI band (top), Map (left), Live Readings table (right), Recent Incidents feed (bottom). All four react to the same `reading:new` socket event, filtered through TanStack Query cache invalidation on the `readings.latest` key so updates re-render within 100ms.

Severity is always conveyed through three redundant channels — colour, text label, and icon — using the shared `color.severity.{healthy|warning|critical|offline}` token set with `value`, `fill`, `text`, `bg`, and `glow` slots. The map uses Leaflet `divIcon` markers (14px circle, severity `fill`, 2px white border, severity icon); critical pins pulse with a 2000ms halo (`motion.pin_pulse_ms`), warning pins pulse only when `.animated`, healthy is calm. The Live Readings table uses monospace metric values for column alignment and severity-coded row treatment: critical rows carry a 4px critical left border, 3px inner border, and an 8px outer critical glow, with `aria-live="polite"`; each updated value plays a 1200ms transient per-update glow (UX-DR-6) and resets the age column to "just now". The Viewer role sees the table read-only but still with all visual severity rules. The KPI band is the saturated severity band visible from the topbar.

The connection-state UX must surface disconnects immediately: a `Reconnecting…` banner appears at the top of the page, all API-bound action buttons (e.g., "Acknowledge") are disabled with the tooltip "Unavailable while offline. Showing last-known data.", and the banner stays visible until a fresh `reading:new` event arrives after reconnect. Offline devices shift their map marker to the `offline` severity token and the `Reconnecting…` banner is also visible. The Simulator admin tab is gated behind `SIMULATOR_SECRET` (refuses with a calm "Simulator disabled. Set SIMULATOR_SECRET." message when unset) and on RBAC (non-Admin roles see the denied state); every simulator action writes an `AuditLog` row with `event: __simulator_event`. `prefers-reduced-motion: reduce` disables the critical pulse, map pin pulse, and banner fade-in while preserving colour + text + icon.

## Cross-Story Dependencies

Story 2.1 (schemas) is the foundation that 2.2–2.4 all import. Story 2.2 (ingest endpoint) is the runtime that 2.4 (simulator) connects to and that 2.6–2.9 (dashboard, map, table, offline UX) subscribe to via the `reading:new` socket event. Story 2.5 (admin simulator tab) requires the simulator running with `SIMULATOR_SECRET` set and writes `__simulator_event` audit entries that downstream ops views consume. The `aud: device|simulator` JWT shape and the `telemetry:write` scope are defined once in `packages/shared` and reused by Epic 1's auth middleware and Epic 2's ingest and simulator; the `reading:new` event payload is shared by the api emitters and the frontend listeners by construction. The dashboard's read-only incident preview consumed in this epic reads the same card-affordance contract that Epic 4's interactive workflow will use.
