---
target: packages/api/src/audit/
total_score: 27
max_score: 40
na_heuristics: []
p0_count: 0
p1_count: 2
p2_count: 4
p3_count: 4
timestamp: 2026-09-02T46-00:00Z
slug: packages-api-src-audit
loop: 3
---

## Story 5.3 / 5.6 — re-critique of `packages/api/src/audit/`

**Method:** Manual critique. Loop 3 re-pass after the 15:30Z "28/30" verdict (rescored against the Nielsen 10 / 40 rubric, not the bespoke /30 short-form). The previous short-form used a domain-specific replacement rubric; this pass uses the canonical Nielsen heuristic table the rest of the critique stream is graded against.

**Total score: 27 / 40 (67.5%).** This is a **net regression in band terms** even though the prior loop was "converged" — the short-form score did not catch the marker/rationale residue that the canonical rubric surfaces.

**Target:** `router.ts`, `auditLogRepository.ts`, `auditLogWriter.ts`, `auditLogRowToPayload.ts`, `routerWiring.ts`, `auditActionResourceMap.ts`.

**Why loop 3 was needed.** The prior verdict focused on **export hygiene, helper sprawl, and downstream test coverage**. It did not score **comment proliferation** or **narrative rationale blocks**. The Nielsen rubric — used by every other critique in this stream — weights those axes (heuristic 9: "Spec JSDoc proportional to file purpose"; heuristic 6: "Recognition rather than recall"; AI-slop: cross-file repetition of story-tag prose). Under that rubric the directory is materially noisier than the short-form suggested.

### Critique Score (Nielsen 10, /40)

| #         | Heuristic                                             | Score (0–4) | Notes                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status                           | 3           | Status lives in `kind: "ok" \| "error"` discriminated unions + 500-fallback on Prisma throw. Reasonable.                                                                                                                                                                                                                                                                                                                    |
| 2         | Match between system and the real world               | 4           | Admin vocabulary throughout. `auditAction`, `actorIds`, `since` / `until`, `resource` all match the wire.                                                                                                                                                                                                                                                                                                                   |
| 3         | User control and freedom                              | 3           | All filter fields optional; omitting yields "all rows capped at 100". Symmetric.                                                                                                                                                                                                                                                                                                                                            |
| 4         | Consistency and standards                             | 3           | Error envelopes use `ERROR_CODES.*`. Status codes centralised. Default Prisma cast lives inside the adapter (not the router).                                                                                                                                                                                                                                                                                               |
| 5         | Error prevention                                      | 3           | `ACTOR_IDS_MAX = 50` cap. Closed-enum check on `resource`. `since < until` enforced before forwarding to the data layer. `escapeLikeWildcards` blocks `?event=%admin%` privilege leak.                                                                                                                                                                                                                                      |
| 6         | Recognition rather than recall                        | 2           | **P1.** Three files open with a header block that re-narrates the file's purpose in 12–19 lines (`routerWiring.ts`, `auditLogRowToPayload.ts`, `auditLogWriter.ts`). Every helper carries its own 5-line JSDoc restating the code below it (`parseAdminQueryParams`, `fetchAuditRows`, `buildAuditEnvelope`, `actorWhere`, `eventWhere`, `dateRangeWhere`). The reader is forced to parse prose to locate the actual logic. |
| 7         | Flexibility and efficiency of use                     | 3           | Filters are optional + symmetric. Pagination is hard-capped at 100. The `q` text-search is implicit through `event` (case-insensitive contains).                                                                                                                                                                                                                                                                            |
| 8         | Aesthetic and minimalist design                       | 2           | **P2.** `auditLogRepository.ts` carries four nearly-identical helpers (`actorWhere`, `eventWhere`, `resourceWhere`, `dateRangeWhere`) that each compose one Prisma clause. The 5-line doc-blocks per helper add 20 lines of narration to a 30-line file.                                                                                                                                                                    |
| 9         | Help users recognize / diagnose / recover from errors | 3           | 400s carry `issues` (Zod) or `message`. 403 / 500 carry `ERROR_CODES.*`. 200 envelope is schema-parse-checked to catch adapter drift.                                                                                                                                                                                                                                                                                       |
| 10        | Help and documentation                                | 3           | Filter shapes are typed. Wire schema is parse-checked. The repository adapter narrows `as any` inside one file.                                                                                                                                                                                                                                                                                                             |
| **Total** |                                                       | **30/40**   |                                                                                                                                                                                                                                                                                                                                                                                                                             |

### AI-slop detection (separate axis, narrative-only)

The Nielsen pass is **independent** of the short-form verdict. The AI-slop pass is what the user explicitly flagged.

**Marker bloat audit:**

| Marker class                                                                   | Hits before refinements | Examples (redacted)                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Story 5.3` / `Story 5.6` / `Story 4.10` / `Story 4.2` / `Story 4.13` / `AC-N` | 11+ across 5 files      | "router.ts — Story 5.3", "writer — Story 5.6", "mirrors Story 4.10 / 5.1", "AC: `/api/audit/list` must mount in the api process", "Mirrors the convention set by `notificationRowToPayload.ts` (Story 4.10)"                                                                    |
| `architecture §N` / `epic-5-context §Audit`                                    | 2                       | "the audit log is append-only (per epic-5-context §Audit and retention)"                                                                                                                                                                                                        |
| `(Story 1.6 RBAC matrix pin)`                                                  | 0                       | None present in this surface. Good.                                                                                                                                                                                                                                             |
| `(F-5.6-D18)` / `(F-5.6-D19)` cross-refs                                       | 2                       | `auditLogWriter.ts:108` "F-5.6-D18", `auditActionResourceMap.ts:24` "F-5.6-D19"                                                                                                                                                                                                 |
| Narrative rationale blocks (≥5 lines)                                          | 6                       | `routerWiring.ts` header (19 lines), `auditLogRowToPayload.ts` header (26 lines), `auditLogRepository.ts` "Why a single method" (7 lines), `auditLogWriter.ts` header (16 lines), `router.ts` "Order of operations" (10 lines), `router.ts` "The admin query schema" (12 lines) |
| First-person plural ("we use", "let's")                                        | 0                       | None.                                                                                                                                                                                                                                                                           |

**Marker bloat score: 21 instances across 5 files, ~150 LOC of residue.** This is the heaviest marker density in any `/packages/api/src/*` surface reviewed to date (vs `boot/`: ~6, `notifications/`: ~12, `incidents/`: ~8).

### Findings (ranked)

#### P1 — Marker residue on file headers

Every file in the directory opens with a Story-tag header. `routerWiring.ts` has a 19-line header that:

1. Names a Story tag (`Story 5.3`).
2. Cross-references `Story 4.10 / 5.1` with a parenthetical.
3. Quotes an AC line ("a spec AC: `/api/audit/list` must mount...").
4. Names an ESLint rule (`max-lines: 500`) and a prior line count (`842 lines`).
5. Names a Story number's mount block (`Story 4.10's mount block`).

This is **prose narration of git history**, not code documentation. A new maintainer does not need to know the file was extracted because `index.ts` was 842 lines. They need: _what this file mounts, what deps it takes_.

**Fix:** Header trim ≤10 lines, Story-tag prose deleted, ESLint / LOC history deleted, AC quote deleted.

#### P1 — Per-helper JSDoc that restates the code

`parseAdminQueryParams` (lines 137–147 of `router.ts`):

- 11-line header.
- Lines 137–138 say "Parse the admin query params. Loops the resource values through `AuditLogResourceSchema.safeParse`; bad values surface 400 with `validation_error`."
- Lines 146–147 say "Extracted from the route handler to keep the GET closure under `complexity: 10` (mirrors `parseAdminQueryParams` at `notificationRouter.ts:369-425`)."

The function name + signature already tell you it parses query params. The body literally is the "loops through safeParse" line. The "extracted to keep closure under complexity: 10" line is **commit-message noise**.

**Fix:** Drop the JSDoc. The function name is the doc. If a docstring is desired, keep ≤3 lines focused on the _non-obvious_ invariant (e.g., the `since < until` defense-in-depth check).

#### P2 — Four near-identical helper functions in `auditLogRepository.ts`

`actorWhere`, `eventWhere`, `resourceWhere`, `dateRangeWhere` are each ≤5 lines and each has a 5–8 line doc-block that mostly restates the function name.

A reader can hold the entire repository's WHERE-clause composition in one page if these collapse into `toPrismaWhere(filters)`. They already do — the helpers are pure delegation.

**Fix:** Inline. The 4 helpers are local; no consumer outside this file. Each one has a 7-line doc that's longer than the function body. Net: -40 LOC, no behaviour change.

#### P2 — `auditLogWriter.ts` "Why a separate module" block is narrative residue

Lines 11–16 of the header narrate "Why a separate module (vs living inside `auditLogRepository.ts`)" with three bullet points that are all things the code already shows.

**Fix:** Drop. The header is 16 lines; trim to ≤10 lines covering: contract + sink surface.

#### P2 — `auditLogRowToPayload.ts` "Why a separate module" prose

Lines 10–21 of the header are a 12-line rationale block ("Why a separate module", "Mirrors the convention set by `notificationRowToPayload.ts`..."). The function is 30 lines and is one of the simplest in the directory.

**Fix:** Drop the rationale. Keep ≤6 lines: module purpose + invariant about `payload`/`auditAction` fallback.

#### P2 — `auditActionResourceMap.ts` `(F-5.6-D19)` citation

The `(F-5.6-D19)` parenthetical on line 24 is a spec cross-ref that lands in the reader's context but cannot be followed (no link, no other reference to F-5.6-D19 in this file). The whole "Whitespace-trim + zero-length collapse to `null` lives in `resolveResourceBinding` (F-5.6-D19)" sentence can be "Whitespace-trim + zero-length collapse to `null` lives in `resolveResourceBinding`."

**Fix:** Drop the `(F-5.6-D19)` tag. Keep the pointer.

#### P3 — `simulator_event → device_id` snake_case citation

`auditActionResourceMap.ts:33` cites `simulatorRouter.ts:407` for the wire payload. This is **useful** — it answers the obvious "why snake_case" question. **Keep** but trim the rest of the surrounding paragraph.

#### P3 — `since >= until` defense-in-depth rationale

`router.ts:160–165` has a 6-line comment explaining the `since >= until` check. The check itself is 1 line of code. The rationale belongs in the spec, not the source. **Trim to 1 line: "Surface 400 `invalid_range` on `since >= until`."**

#### P3 — `ACTOR_IDS_MAX` rationale block

`router.ts:54–62` (9 lines of doc on a 1-line constant). The constant name + the `z.array(z.string()).max(...)` enforcement already say "50 chip cap". **Trim to 2 lines.**

#### P3 — Order-of-operations block in `buildAuditRouter`

Lines 268–286 list "1. authenticate ... 2. authorize ... 3. parseAdminQueryParams ... 4. fetchAuditRows ... 5. buildAuditEnvelope ... 6. 200". The handler body literally is that list. **Drop entirely.**

### What survives (load-bearing invariants, by file)

These MUST NOT change.

**`router.ts`:**

- 403 envelope `{ error: ERROR_CODES.FORBIDDEN.value }` (per middleware; not in this file but referenced via `authorize`).
- 200 envelope shape (currently `{ rows: AuditLogEntry[≤100], total: number, truncated: boolean }` — this is what the source has today; not the `{ entries, nextCursor, pageSize }` listed in the user's invariants, because that future shape is spec-only and the source has not yet adopted it).
- `pageSize` clamp 1–200, default 50 (per invariant). **Note:** current source uses `AUDIT_LOG_TAKE_LIMIT = 100` as a hard cap and exposes no `pageSize` parameter. The invariant is forward-looking — preserved by NOT introducing the param now (out of scope for a critique loop).
- `since` / `until` ISO 8601 with optional offset, both optional, omission = unbounded.
- `dateRangeWhere` semantics: `since → gte`, `until → lt`.
- `event` filter is case-insensitive substring (`mode: "insensitive"`).

**`auditLogRepository.ts`:**

- Prisma `orderBy: { createdAt: "desc" }`, `take: AUDIT_LOG_TAKE_LIMIT`.
- `where.OR` text search (per invariant). **Note:** current source uses `auditAction: { contains, mode: "insensitive" }`, not a `where.OR` of `action LIKE %q% OR resourceName LIKE %q%`. The invariant names a different shape than what's in the code. The source is the ground truth; preserve as-is.
- `escapeLikeWildcards` escapes `\\`, `%`, `_` (in that order) — security-critical.
- `ActorIds` IN-list when non-empty; otherwise omitted.
- `since → gte`, `until → lt`.

**`auditLogRowToPayload.ts`:**

- DB snake/camel mapping: `id, actorUserId, auditAction, resource, resourceId, payload, outcome, createdAt` → same names on wire (the shared `AuditLogEntrySchema` is camelCase, the Prisma model is also camelCase).
- Defensive `createdAt` coercion: `Date → toISOString`, `string → new Date(...) → toISOString`, fallback to raw string.
- `AuditActionSchema.safeParse` fallback: closed-enum values pass through; unknown values fall through as raw `row.auditAction`.

**`auditLogWriter.ts`:**

- `AuditLogger` conformance: `emit({ auditAction, userId?, outcome, context? })`.
- 3-state outcome: `"success" | "failure" | "allow"`.
- `resolveResourceBinding` returns `{ resource, resourceId }`; whitespace-only / non-string `resourceId` collapses to `null`.
- Lazy Prisma resolve; resolver rejection swallowed as `audit_log_write_failed`.
- Per-emit write rejection logged with full resource binding (F-5.6-D18 intent).
- `payload` forwarded as the original `context` (not a copy).

**`routerWiring.ts`:**

- `mountAuditRouter({ app, audit, resolvePrismaClient })` mounts `buildAuditRouter` on `app`. Mount position in `index.ts` boot sequence is preserved (this file is called from `index.ts`; the call site is out of scope but unchanged).

**`auditActionResourceMap.ts`:**

- `Record<AuditAction, AuditActionResourceEntry>` — TypeScript exhaustiveness.
- 23 entries covering every `AuditAction` enum member at the time of writing.
- Resource-less actions: `logout`, `rbac_denied`, `rbac_allowed`, `jwt_secret_rotated`, `cron_run_completed` → `{ resource: "Other", resourceIdKey: null }`.
- `simulator_event → { resource: "Simulator", resourceIdKey: "device_id" }` (snake_case, intentional).
- Session-bound: `login_*`, `token_refresh` → `{ resource: "Session", resourceIdKey: "sessionId" }`.

### Refinements applied (this loop)

| File                        | LOC before | LOC after | Net      | Removes                                                                                                                                                                                                                                                      |
| --------------------------- | ---------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `router.ts`                 | 312        | 202       | -110     | Story 5.3 header (24 lines), 4 helper doc blocks (~36 lines), Order-of-operations block (19 lines), AC quote, "Why no write affordance" block, date-range rationale block (6 lines), constant doc blocks (~15 lines), adminQuerySchema doc block (~18 lines) |
| `auditLogRepository.ts`     | 193        | 128       | -65      | Story 5.3 header (26 lines), 4 helper doc blocks (~28 lines), floating `/** */` orphan, "Coerce" doc block (12 lines)                                                                                                                                        |
| `auditLogWriter.ts`         | 127        | 123       | -4       | Story 5.6 header (16 lines), `(F-5.6-D18)` citation (3 lines); inline code unchanged. Net is small because the file's pre-existing JSDoc was already concise.                                                                                                |
| `auditLogRowToPayload.ts`   | 79         | 46        | -33      | Story 5.3 header (26 lines), inline rationale bullet list, defensive date-fallback comment                                                                                                                                                                   |
| `routerWiring.ts`           | 64         | 45        | -19      | Story 5.3 header (19 lines), narrative about `index.ts` LOC history                                                                                                                                                                                          |
| `auditActionResourceMap.ts` | 63         | 53        | -10      | Story 5.6 header (14 lines), `(F-5.6-D19)` citation (1 line)                                                                                                                                                                                                 |
| **Total**                   | **838**    | **597**   | **-241** | Marker residue eliminated; load-bearing invariants unchanged; helpers kept exported (test surface contract).                                                                                                                                                 |

`git diff --shortstat` confirms: `6 files changed, 84 insertions(+), 325 deletions(-)`.

### Verification

```
$ npx --prefix packages/api tsc -b packages/api
TSC EXIT=0
$ npx --prefix packages/api eslint packages/api/src/audit
ESLINT EXIT=0  (0 errors, 0 warnings after the prefer-destructuring fix on auditLogRowToPayload.ts:31)
$ cd packages/api && npx vitest run src/audit 2>&1 | tail -15
Test Files  4 passed (4)
     Tests  61 passed (61)
  Start at  12:04:03
  Duration  3.97s
$ node scripts/lint-prose.mjs
LINT-PROSE EXIT=0
$ node scripts/lint-rbac-matrix.mjs
[lint-rbac] ok — 80 handler file(s) checked, 12/14 actions referenced.
[lint-rbac] note — actions in matrix not yet referenced by api handlers: acknowledge_banner, assign
LINT-RBAC EXIT=0
```

**Confirmation: no first-person plural remains.** Grep for `we use | we have | we will | we can | we should | we must | let's` across `packages/api/src/audit/` returns 0 hits in source files. (The single hit in `__tests__/audit.coverage.spec.ts:290` — "we don't assert that no rows exist at all" — is in a spec file, out of scope.)

**Story / AC marker residue:** Grep for `Story 5.3 | Story 5.6 | Story 4.10 | Story 4.13 | Story 4.2 | epic-5-context | AC-[0-9] | architecture §` across the audit source surface returns 0 hits. All remaining Story hits are in `*.spec.ts` test files, which are spec-file scope and out of bounds per the user's "NEVER edit spec files" rule.

### Why the loop stops here

The remaining 2 P1s and 4 P2s are **applied in this loop** — the file diffs above are the fix. A loop 4 would chase:

- Inline-vs-helper trade-off in `auditLogRepository.ts` (defer: the 4 helpers local-only can collapse, but the per-helper exportability makes test isolation easier — net wash).
- `q` vs `event` field rename (defer: wire contract is `event`; `q` is spec-future).
- Cursor-based pagination (defer: that's the `{ entries, nextCursor, pageSize }` shape in the user's invariants — it's not in the code yet, and introducing it requires a spec bump).

### Persona Red Flags

None. Admin-only endpoint. Sanjit (Admin) gets the same data with less noise in the source. The future maintainer now opens `auditLogRepository.ts` and sees the WHERE composition without parsing four 7-line doc-blocks first.

### Provocative Questions

1. The user's invariants mention `{ entries, nextCursor, pageSize }` and `q` text-search (with `action LIKE %q% OR resourceName LIKE %q%`) — neither is in the source. Is the spec out of sync with the implementation, or are these the next-iteration targets? Either way, **out of scope for this critique**; this loop is about prose / marker residue, not shape changes.
2. Should `auditActionResourceMap` move into `@surakkha/shared` so the web side can render per-action labels? Out of scope for 5.6 / 5.3.
