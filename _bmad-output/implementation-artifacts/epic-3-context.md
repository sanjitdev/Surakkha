# Epic 3 Context: Rules & Alerts

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

When a sensor reading breaches a threshold, the platform must surface a severity-coded alert and, for warning/critical, open an incident — all within a 3-second latency SLA. The rules engine evaluates every persisted reading against a stored set of `Rule` rows; alerts are de-bounced per `(device, metric, severity)`; warning/critical alerts auto-create an `Incident` row whose state machine is governed by Epic 4. Defaults come from the BRD/WHO/BSTI threshold table; admins can override per device.

## Stories

- Story 3.1: Rules Table + Prisma Schema
- Story 3.2: Three Rule Types + Evaluation Engine
- Story 3.3: Default Thresholds Seed Script
- Story 3.4: De-bouncing
- Story 3.5: Alert Lifecycle
- Story 3.6: Auto-Create Incident from Warning/Critical Alert
- Story 3.7: /admin/thresholds Admin Tab

## Requirements & Constraints

- The `Rule` model is the typed source of truth for the engine. Fields are bound to the wire-contract shape in `docs/architecture.md` §4.1.
- Rules are global (`device_id IS NULL`) or per-device (`device_id` set). Both must coexist in the same table.
- Rules are versioned: editing a threshold creates a new row at `version + 1` with `is_active: true`; the old row flips to `is_active: false` (Story 3.7). Story 3.1 only models the columns and unique constraint that make this work — the edit logic lands in 3.7.
- v1 rule types are exactly `instant`, `rate`, `absence`. New types are rejected at registration (Story 3.2). Story 3.1's enum must contain exactly these three.
- Operators are exactly `>=`, `>`, `<=`, `<`, `==` (Story 3.2). Story 3.1's enum must contain exactly these five.
- Severity is set by the rule, not inferred. Story 3.1's enum must contain `info | warning | critical` to match the wire contract (`packages/shared/src/events.ts` and `packages/shared/src/dashboard.ts`).
- The metric identifier matches the keys carried in `Reading.metrics` JSON. The architecture §5 lists `MetricDefinition` as a separate table (v2 feature) — Story 3.1 does not introduce it; `Rule.metric` is a free string for now.
- The architecture notes "audit-logged on change" for rules. The `AuditLog` table does not yet exist in the Prisma schema; that work is owned by other stories. Story 3.1 only needs the `created_by` column on `Rule` so a future audit row can reference it.
- Migrations are forward-only. New tables and columns land in a new migration file. Existing rows must survive forward migrations (nullable new columns).
- The full 565-test suite (api, web, simulator, db, shared) must keep passing.

## Technical Decisions

- Prisma is the schema source of truth. `packages/db/prisma/schema.prisma` already has `Device`, `Reading`, and an `Incident` placeholder; Story 3.1 adds `Rule` alongside.
- Migration file naming: `YYYYMMDDHHMMSS_<topic>/migration.sql` matching the existing pattern. Topic: `rule_table`.
- Generator config already pins `binaryTargets = ["native", "debian-openssl-3.0.x"]` for Docker — do not change.
- Enums are Prisma enums (not free strings) so the engine (Story 3.2) and the wire contract (Story 3.5) can rely on the type. This matches the `IncidentSeverity` precedent in `packages/shared/src/incident.ts` which mirrors wire severities.
- `metric` and `operator` are also Prisma enums for the same reason. `metric` must include at least the six keys the Story 3.3 seed uses: `ph`, `tds_ppm`, `turbidity_ntu`, `chlorine_ppm`, `temp_c`, `water_level_cm`. Architecturally this is the v1 freeze — v2 may grow it via a migration.
- `value` is `Float`. `threshold` is the column name per the AC; map it to the same `Float` to keep the engine code simple in 3.2.
- `device_id` is `String?` (nullable) with an optional FK to `Device.id` and `onDelete: Cascade`. NULL means "global rule."
- Unique constraint: `(device_id, metric, operator, threshold, version)` per the AC. Postgres allows multiple NULL values in a unique constraint column by default, which is exactly what we need for global rules.
- `version Int @default(1)`. `is_active Bool @default(true)`. `created_at / updated_at` follow the existing implicit `DateTime` convention.
- `created_by` is `String?` (nullable). It is NOT an FK to `User` because the `User` table does not exist in the schema yet (see audit-table note in §Requirements). It will become an FK in a later story when `User` lands.
- No backfill or seed in this story. Story 3.3 owns the seed. The migration must produce an empty `Rule` table.

## UX & Interaction Patterns

- No UX changes in this story. The `/admin/thresholds` tab (Story 3.7) is the eventual consumer; the live-readings table (Story 2.8) and the map (Story 2.7) eventually render severity colours driven by fired rules, but those flows do not change in Story 3.1.

## Cross-Story Dependencies

- Story 3.2 (evaluation engine) reads from `Rule`. Schema must be ready first.
- Story 3.3 (seed script) writes to `Rule`. Must run after 3.1's migration.
- Story 3.5 (alert lifecycle) writes an `Alert` row referencing `Rule.id`. The `Alert` model itself is owned by 3.5, not 3.1.
- Story 3.7 (`/admin/thresholds` admin tab) edits `Rule` rows and writes `AuditLog` rows. The `AuditLog` table is owned by a separate story and is not a dependency of 3.1.
- No Epic 4 or later dependency on Story 3.1's schema.
