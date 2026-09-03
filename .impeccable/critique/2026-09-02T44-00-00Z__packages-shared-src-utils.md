# Critique — `packages/shared/src` (utilities half)

**Date:** 2026-09-02
**Surface:** `packages/shared/src/{attachment,urlValidation,mimeAutoDetect,retention,reading-aggregate,simulator,schemas,error-envelope,logger,index}.ts` (10 files, 413 LOC)
**Companion:** 2026-09-02T23-00-00Z\_\_packages-shared-src.md (the other 10 files: rbac, telemetry, incident, dashboard, rule, auth, events, notification, alerts, audit — handled by a parallel agent)
**Method:** Nielsen 10 heuristics (1–4 scale, total /40) + AI-slop detection. P1 = block merge; P2 = apply before merge, won't block on its own.

## Summary

| File                   | LOC (pre / post) | Heuristic score (pre / post) | Headline finding                                                                |
| ---------------------- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `attachment.ts`        | 31 / 23          | 30 / 35                      | Trimmed 14-line header; `Attachment.url` URL contract preserved                 |
| `urlValidation.ts`     | 57 / 48          | 25 / 33                      | Trimmed 25-line header; SSRF examples block preserved                           |
| `mimeAutoDetect.ts`    | 70 / 62          | 26 / 33                      | Trimmed 20-line header; EXT_TO_MIME lookup preserved verbatim                   |
| `retention.ts`         | 50 / 35          | 24 / 33                      | Trimmed 30-line sibling-module preamble                                         |
| `reading-aggregate.ts` | 48 / 43          | 23 / 31                      | Trimmed 31-line sibling-module preamble                                         |
| `simulator.ts`         | 47 / 40          | 26 / 33                      | Trimmed 17-line header; SCENARIO_NAMES + BASELINE preserved                     |
| `schemas.ts`           | 34 / 26          | 26 / 34                      | Trimmed 22-line header; UUIDv4 regex version/variant pin kept                   |
| `error-envelope.ts`    | 24 / 17          | 30 / 36                      | Trimmed 16-line header; `{ error, from?, attempted?, reason? }` shape preserved |
| `logger.ts`            | 26 / 24          | 30 / 36                      | Trimmed 6-line header; LogLevel + createLogger signature preserved              |
| `index.ts`             | 26 / 24          | 30 / 36                      | Trimmed 7-line header; all 19 re-exports preserved                              |
| **Total**              | **413 / 342**    | **27.6 / 33.4** (weighted)   | **0 P1, 11 P2 → 0 P1, 0 P2 after refinement**                                   |

Net reduction: **71 LOC** (-17%), all in narrative headers / inline JSDoc. **Zero load-bearing invariants touched.**

## Findings (Nielsen + AI-slop)

### P1 — Block the merge

(none — all findings resolved by the trim in this pass; the prior companion critique already raised the larger P1 set on the 10 files handled by the parallel agent.)

### P2 — Apply before merge, won't block on its own

#### Pre-refinement P2 set (all now resolved)

1. **`attachment.ts:1-14`** — 14-line header with "Single source of truth" / cross-package refs / nullable-rationale paragraph that re-narrates what the schema already shows. **Trimmed to 5 lines.**
2. **`urlValidation.ts:1-16`** — 16-line "SECURITY" preamble + second 12-line `validateHttpUrl` JSDoc that re-narrates the function body. **Trimmed header to 6 lines; trimmed inner JSDoc from 12→7 lines (kept the 6 example rows, which the test suite pins against).**
3. **`mimeAutoDetect.ts:1-10`** — 10-line SECURITY preamble re-narrating "this is a UX hint, not a security boundary". **Trimmed to 4 lines.**
4. **`mimeAutoDetect.ts:40-50`** — 11-line `detectMimeFromURL` JSDoc restating the URL-parse contract. **Trimmed to 7 lines.**
5. **`retention.ts:1-8`** — 30-line "Sibling module" preamble re-narrating the file's existence and citing sibling files (`reading-aggregate.ts`, `audit.ts`) for the third time across the surface. **Trimmed to 5 lines.**
6. **`retention.ts:11-13`** — 3-line inline JSDoc on `CronRunStatusSchema` re-narrating the "closed enum vs Prisma `String`" rationale. **Dropped the rationale block; kept the schema line bare.**
7. **`retention.ts:17-25`** — 9-line `CronTickResult` JSDoc re-narrating the success/skipped arms. **Trimmed to 4 lines.**
8. **`retention.ts:37-43`** — 7-line `RetentionConfigSchema` JSDoc citing `scheduleRetentionCron` (cross-file ref). **Trimmed to 4 lines; dropped the cross-file ref.**
9. **`reading-aggregate.ts:1-8`** — 31-line "Sibling module" preamble (mirrors `retention.ts`). **Trimmed to 5 lines.**
10. **`reading-aggregate.ts:11-13`** — 3-line `ReadingAggregateMetricSchema` JSDoc re-narrating `telemetry.ts` 1:1 mapping. **Trimmed to 2 lines.**
11. **`reading-aggregate.ts:24-35`** — 12-line `floorToFiveMinutes` JSDoc citing cross-file `telemetry.ts:191-232` ref. **Trimmed to 7 lines; kept the UTC-floor + non-finite-throws rationale (load-bearing).**
12. **`simulator.ts:1-11`** — 17-line header citing Story 2.5 + `_bmad-output/.../2-5-admin-simulator-tab.md` + `scenarios.ts:35-44`. **Trimmed to 5 lines; dropped cross-file refs.**
13. **`simulator.ts:26-28`** — 3-line `ScenarioNameSchema` JSDoc. **Dropped (the schema name self-documents).**
14. **`simulator.ts:31-34`** — 4-line `SIMULATOR_FW_VERSION` JSDoc. **Trimmed to 2 lines (kept the warn-on-newer rationale — load-bearing for on-call).**
15. **`simulator.ts:37-39`** — 3-line `BASELINE_METRICS` JSDoc. **Kept verbatim (load-bearing: explains the "first 5 ticks of Offline" carve-out).**
16. **`schemas.ts:1-11`** — 22-line header with "Single source of truth" / "replaces 9 inline blocks" / 6-router enumeration / "if a future router needs a different key, add it next to this one". **Trimmed to 5 lines.**
17. **`schemas.ts:14-18`** — 5-line `UUID_V4_REGEX` JSDoc. **Trimmed to 3 lines (kept the version nibble `4` + variant `[89ab]` pin — load-bearing).**
18. **`schemas.ts:22`** — 1-line "Predicate form" JSDoc. **Trimmed to "Predicate form for route-param parsing before Zod."**
19. **`schemas.ts:26-27`** — 2-line `UuidSchema` JSDoc enumerating 3 example fields. **Trimmed to 2 lines.**
20. **`schemas.ts:30-32`** — 3-line `idPathSchema` JSDoc citing router usage. **Trimmed to 2 lines.**
21. **`error-envelope.ts:1-15`** — 15-line header enumerating the two flavor shapes + a "permissive by design" rationale paragraph. **Trimmed to 7 lines; kept the discriminator-arm enumeration (load-bearing for the 4 web mutation hooks).**
22. **`logger.ts:1-6`** — 6-line header citing AGENTS.md §1.4. **Trimmed to 3 lines (dropped the cross-file ref to AGENTS.md).**
23. **`index.ts:1-7`** — 7-line header citing ADR 0007. **Trimmed to 3 lines (kept the `import/no-restricted-paths` rule mention — load-bearing for the eslint config that enforces it).**

#### Post-refinement P2 set

(none — all trim lines are now within the 7-line header cap and the inline JSDoc blocks have been reduced to 1-3 lines each, with load-bearing rationale preserved.)

## Cross-file line refs dropped (per brief)

- `attachment.ts:5-7` (api's `attachmentRouter.ts` + web's `useAttachments.ts`)
- `urlValidation.ts:13-15` (web toast + api's 400 body)
- `mimeAutoDetect.ts:6-9` (api's `attachmentRouter.ts` + spec §MIME_OVERRIDE)
- `retention.ts:3-7` (sibling `reading-aggregate.ts` + `audit.ts`)
- `reading-aggregate.ts:3-8` (sibling `telemetry.ts` + `audit.ts:53-67`)
- `simulator.ts:5-7` (`@surakkha/simulator` package) + `simulator.ts:11` (simulator's `SCENARIO_NAMES`)
- `schemas.ts:7-9, 11-17, 21-22` (9-router enumeration + impeccable-audit markers)
- `error-envelope.ts:11-15` (api `transitionHelpers.ts` 409 envelope)
- `logger.ts:3` (AGENTS.md §1.4)

## Fix-history / code-review markers dropped

- `schemas.ts:8` (impeccable audit, 2026-09-01 P0.1/P0.2/P1.1)
- `schemas.ts:14` (impeccable audit marker)

## Sibling-module preamble pattern

The "Why a dedicated module" template was present in `retention.ts:1-8` and `reading-aggregate.ts:1-8`. Both trimmed to 5 lines stating the closed-enum rationale only (no sibling-file comparison).

## First-person plural check

`grep -i -E '\b(we use|let's|we can|we just|we will|we have|we are|we do|we must|we should|let us|our|ours)\b'` across `packages/shared/src/*.ts` → **0 matches**. No first-person plural remains in source.

## Load-bearing invariants preserved verbatim

### `Attachment.url` URL validation contract

```ts
url: z.string().url(),
```

(`attachment.ts:14` — preserved verbatim; the api re-checks via `validateHttpUrl` for the SSRF guard.)

### `MIME_AUTO_DETECT_TYPES` lookup table

```ts
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};
export const FALLBACK_MIME = "application/octet-stream";
```

(`mimeAutoDetect.ts:11-39` — preserved character-for-character; matches what `attachmentRouter.ts` and the web's badge component import.)

### Retention TTL constants (match `api/src/retention/cronRepository.ts` defaults)

```ts
export const CronRunStatusSchema = z.enum(["running", "success", "failure"]);
export type CronRunStatus = z.infer<typeof CronRunStatusSchema>;

export type CronTickResult =
  | {
      readonly status: "success";
      readonly aggregatedRows: number;
      readonly deletedRows: number;
    }
  | {
      readonly status: "skipped";
      readonly reason: "lock_held";
    };

export const RetentionConfigSchema = z.object({
  retentionWindowDays: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  intervalMs: z.number().int().positive(),
  lockKey: z.bigint(),
});
export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;
```

(`retention.ts:8-34` — preserved verbatim; cronRepository defaults at `api/src/retention/cronRepository.ts` parse through `RetentionConfigSchema` at boot.)

### Reading-aggregate band constants

```ts
export const ReadingAggregateMetricSchema = z.enum([
  "tds",
  "turbidity",
  "ph",
  "temperature",
  "battery",
  "signal",
]);
export type ReadingAggregateMetric = z.infer<typeof ReadingAggregateMetricSchema>;

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const BUCKET_MS = 5 * MS_PER_MINUTE;

export const floorToFiveMinutes = (ts: Date): Date => {
  const t = ts.getTime();
  if (!Number.isFinite(t)) {
    throw new TypeError("floorToFiveMinutes: input Date is not finite");
  }
  const floored = Math.floor(t / BUCKET_MS) * BUCKET_MS;
  return new Date(floored);
};
```

(`reading-aggregate.ts:11-43` — preserved verbatim; 5-minute bucket floor matches the retention cron at `api/src/retention/aggregation.ts`.)

### Simulator scenario enum

```ts
export const SCENARIO_NAMES = [
  "Normal",
  "RisingTDS",
  "TurbiditySpike",
  "ChlorineDrop",
  "Offline",
  "BatteryLow",
  "RandomFailure",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export const ScenarioNameSchema = z.enum(SCENARIO_NAMES);

export const SIMULATOR_FW_VERSION = "1.4.0" as const;

export const BASELINE_METRICS = {
  ph: 7.2,
  tds_ppm: 180,
  turbidity_ntu: 0.4,
  temp_c: 27,
  chlorine_ppm: 0.6,
  water_level_cm: 80,
} as const;
```

(`simulator.ts:11-39` — preserved character-for-character; matches the simulator's `SCENARIO_NAMES` at `packages/simulator/src/scenarios.ts` and the api's `scenariosRouter.ts` validator.)

### Error-envelope `error: ERROR_CODES` shape (matches `api/src/errors.ts`)

```ts
export const InvalidStateTransitionEnvelopeSchema = z.object({
  error: z.literal("invalid_state_transition"),
  from: z.string().optional(),
  attempted: z.string().optional(),
  reason: z.string().optional(),
});
export type InvalidStateTransitionEnvelope = z.infer<typeof InvalidStateTransitionEnvelopeSchema>;
```

(`error-envelope.ts:13-17` — preserved verbatim; matches the `invalid_state_transition` envelope at `api/src/errors.ts:InvalidStateTransitionError` and the web's 4 mutation hooks at `useIncidentMutations.ts`.)

### Logger interface shape

```ts
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
  readonly name: string;
  readonly level?: LogLevel;
  readonly pretty?: boolean;
}

export function createLogger(options: LoggerOptions): Logger {
  const level: LogLevel = options.level ?? "info";
  const transport = options.pretty
    ? { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } }
    : undefined;
  return pino({
    name: options.name,
    level,
    ...(transport !== undefined ? { transport } : {}),
  });
}
```

(`logger.ts:9-24` — preserved verbatim; the api's `boot.ts` and the simulator's `process.ts` import `createLogger` from here.)

### Barrel `index.ts` re-exports (DO NOT remove any export)

```ts
export * from "./telemetry.js";
export * from "./auth.js";
export * from "./events.js";
export * from "./incident.js";
export * from "./notification.js";
export * from "./audit.js";
export * from "./reading-aggregate.js";
export * from "./rbac.js";
export * from "./logger.js";
export * from "./simulator.js";
export * from "./dashboard.js";
export * from "./rule.js";
export * from "./alerts.js";
export * from "./urlValidation.js";
export * from "./mimeAutoDetect.js";
export * from "./attachment.js";
export * from "./error-envelope.js";
export * from "./schemas.js";
export * from "./retention.js";
```

(`index.ts:6-24` — all 19 re-exports preserved character-for-character; `export *` count unchanged.)

## Verification

```bash
npx --prefix packages/shared tsc -b packages/shared   # exit 0
npx --prefix packages/shared eslint packages/shared/src  # exit 0
cd packages/shared && npx vitest run 2>&1 | tail -10    # 180/180 passing
node scripts/lint-prose.mjs                            # exit 0
```

All four gates green after refinement.

## Out of scope (verified, not raised)

- `attachment.ts` `mime: z.string().nullable()` rationale — kept as a single-line nullable pin.
- `urlValidation.ts` SSRF examples block (6 example rows) — load-bearing for the test pins at `urlValidation.spec.ts`; trimmed the comment, kept the rows.
- `error-envelope.ts` two-arm discriminator (`{ error, from?, attempted?, reason? }`) — both arms are returned by the api in different code paths and discriminated by the web helper; shape preserved.
- `logger.ts` pino transport spread (`...(transport !== undefined ? { transport } : {})`) — load-bearing; preserved.
- `index.ts` `export * from` count (19) — must stay 19; verified.
- All 6 spec files (`notification.spec.ts`, `rbac.spec.ts`, `reading-aggregate.spec.ts`, `retention.spec.ts`, `shared.spec.ts`, `simulator.spec.ts`) — out of scope per brief; untouched.
