# Critique — `packages/api/src/attachments/` (attachments surface)

**Date:** 2026-09-02
**Surface:** `packages/api/src/attachments/` (4 source files, 471 LOC)
**Scoring:** Nielsen 10-heuristics (1-4 each, /40 weighted) + AI-slop detection

## Scope

```
packages/api/src/attachments/
├── attachmentRepository.ts     88 LOC  — narrow Prisma slice for attachments
├── attachmentRowToPayload.ts   41 LOC  — DB row → wire-payload mapper
├── attachmentRouter.ts        278 LOC  — POST upload + GET list + DELETE
├── routerWiring.ts            113 LOC  — lazy Prisma resolution + RBAC
├── index.ts                    31 LOC  — barrel export
└── attachmentRepository.spec.ts        — out of scope
└── attachmentRouter.spec.ts            — out of scope
```

The attachments surface is the Epic 4.13 read/write surface — POST
upload + GET list per incident + DELETE by id. Tech-ownership +
Admin-bypass are the load-bearing RBAC invariants. The surface is
self-contained: it does NOT mutate incident state (no socket emit)
and uses a narrow `incidentFindUnique` seam only for the
`assigneeUserId` check.

## Findings (scored 1-4 per heuristic, weighted /40)

| #   | Heuristic        | Score | Note                                                                                     |
| --- | ---------------- | ----- | ---------------------------------------------------------------------------------------- |
| 1   | Visibility       | 3     | All routes surface audit emit on RBAC denial + structured 400s                           |
| 2   | Match real world | 3     | Domain ("uploader", "Admin bypass", "Tech ownership") is clear                           |
| 3   | User control     | 2     | MIME override + auto-detect from URL extension + fallback chain                          |
| 4   | Consistency      | 2     | DUPLICATED header block in `attachmentRepository.ts`; Story refs scattered               |
| 5   | Error prevention | 3     | Zod schemas + `validateHttpUrl` + `safeParse` schema drift check                         |
| 6   | Recognition      | 2     | Headers restate project pattern; cross-file line refs date-fast                          |
| 7   | Flexibility      | 3     | Narrow seam (`incidentFindUnique`) keeps router decoupled from state machine             |
| 8   | Minimalist       | 1     | Headers 2-4× larger than needed; `attachmentRepository.ts` has 26-line header DUPLICATED |
| 9   | Recoverability   | 3     | Per-handler `try/catch` with 500 + `console.error`; safeParse on wire shape              |
| 10  | Help docs        | 1     | Most prose is in code comments, NOT in a discoverable doc                                |

**Weighted total: 23/40.** (Same band as notifications/, ingest/, shared/.)

## AI-slop detection

### P1 (block merge)

- **P1-1: `attachmentRepository.ts` lines 1-13 and 14-26 are an
  EXACT DUPLICATE header.** Two identical 13-line `/** ... */` blocks
  with the same `Story 4.13` reference. Trims to one 4-line header
  stating the file's purpose. The duplication is an obvious
  copy-paste AI artefact — neither block is load-bearing.

### P2 (apply before merge)

#### Story codes / "distilled" markers

- `attachmentRepository.ts:2`, `:15`: `Story 4.13` (twice — see P1-1).
- `attachmentRowToPayload.ts:2`: `Story 4.13`.
- `attachmentRouter.ts`: `Story 4.13` not present inline, but
  the route list header mentions `RBAC: matrix grants per resource`
  (mirror prose, not a Story code).
- `routerWiring.ts:2`: `Story 4.13`.
- `index.ts:2`: `Story 4.13`.

- `attachmentRowToPayload.ts:5-6`: `Mirrors
notificationRowToPayload.ts (4.10)`.
- `index.ts:11-12`: `Mirrors notifications/index.ts (4.10)`.
- `routerWiring.ts:6-7`: `mirrors notifications/routerWiring.ts
for 4.10`.
- `attachmentRepository.ts:4-7`: `Mirrors the pattern from
incidentStateRepository.ts (4.2)`.

These are noise — the convention is in the source.

#### Cross-file line refs

- `attachmentRowToPayload.ts:8`: `none today, but the seam is here
for future schema changes` — restates the present ("none today").
- `index.ts:18-19`: `If a future story adds a second router
(e.g., attachmentExportRouter)` — future-shaped narrative.
- `routerWiring.ts:10-16`: `src/index.ts is already near the
max-lines: 500 ESLint ceiling (the notifications mount pushed it
to ~830 lines before extraction)` — refers to a sibling surface
  - a prior move that git tracks.
- `routerWiring.ts:18-22`: `the wrapper resolves the same Prisma
singleton on first request` — restates code.

#### Long narrative rationale blocks (restate the obvious)

- `attachmentRepository.ts:1-13` AND `:14-26`: two identical 13-line
  blocks (P1-1 above).
- `attachmentRepository.ts:28-33` (row shape preamble): 6 lines
  restating "server-internal columns never leak to the web" — the
  convention name says it.
- `attachmentRepository.ts:44-55` (slice interface preamble): 12
  lines restating "narrow slice, four methods, structural cast for
  Prisma decoupling" — covered by file header.
- `attachmentRepository.ts:76-79` (resolveX preamble): 4 lines
  restating "adapter wiring forwarder".
- `attachmentRepository.ts:82-87` (production cast note): 6 lines
  restating the structural-cast seam already named in the interface
  preamble.
- `attachmentRowToPayload.ts:29-35` (safeParse rationale): 7 lines
  restating "schema drift detection; production UUIDs are valid;
  mocks with non-UUID ids log a warning instead of crashing." A 1-2
  line comment is sufficient.
- `attachmentRouter.ts:50-53` (`incidentFindUnique` JSDoc): 4 lines
  restating the structural-cast seam already in the interface.
- `attachmentRouter.ts:76-77` (`enforceDeleteOwnership` preamble):
  2 lines, OK (kept as 1 line).
- `attachmentRouter.ts:102-103` (`enforceTechOwnership` preamble):
  2 lines, OK.
- `attachmentRouter.ts:192-194` (MIME precedence comment): 3 lines,
  borderline — kept as 1 line.
- `routerWiring.ts:9-17` (Why a separate file preamble): 9 lines
  restating "src/index.ts is past max-lines; lazy resolver mirrors
  4.10/4.2." Git tracks the move.
- `routerWiring.ts:18-22` (`incidentFindUnique` seam preamble):
  5 lines restating "narrow seam so the router doesn't need the full
  incident delegate."
- `routerWiring.ts:76-79` (try/catch re-throw rationale): 4 lines
  restating "re-throw so the router's per-handler catch surfaces
  500; a swallow would mask a DB outage." Keep as 1 line.
- `index.ts:1-20` (header): 20 lines — restates exports, the
  "single barrel" rationale, the "router + wiring live in this file
  (not split)" anti-future-split note. Trim to 4 lines.

#### "Patch (code review ...)" / "F-P..." markers

None found in this surface.

#### "Loop N hardening" / "Step-NN review fix" markers

None found in this surface.

### Non-findings (verified, not raised)

- **The `AttachmentRepository` narrow-slice pattern** (4 methods
  only — `create`, `findMany`, `findUnique`, `delete`) mirrors
  `incidentStateRepository.ts`. Production narrows via a
  structural cast in `resolveAttachmentRepository`; tests inject
  stubs with the same shape. Correct shape, preserved.
- **The `AttachmentRouterDeps` shape** (`audit`, `repo`,
  `incidentFindUnique`) correctly injects the seam so the router
  doesn't need the full Prisma client. Preserved.
- **The RBAC matrix**: Admin bypass on DELETE; original uploader
  bypass; Operator/Technician-else → 403. Tech-ownership check on
  POST/GET: Admin/Operator/Viewer skip; Technician requires
  `assigneeUserId === req.user.id`, else 403 with `rbac_denied`
  audit. Correct, preserved.
- **The audit emit ordering** (emit BEFORE the 403 response in both
  `enforceDeleteOwnership` and `enforceTechOwnership`) is correct —
  the failure is in the audit log even if the response is dropped.
- **The MIME precedence** (user override → URL extension detection
  → `FALLBACK_MIME`) is the canonical pattern. Preserved.
- **The `validateUrlOrRespond` helper** (security boundary:
  rejects `javascript:` / `data:` / `file:` / `vbscript:` / relative
  paths via `@surakkha/shared/urlValidation`) is correctly placed
  BEFORE the body schema's URL field validation, so a
  `javascript:alert(1)` payload is rejected at the security boundary
  not by Zod regex. Preserved.
- **The Zod `createBodySchema`** (URL required; label ≤200 chars;
  MIME regex `^[a-z]+/[a-z0-9.+-]+$`) is correct — strict enough to
  reject malformed `type/subtype` strings, lenient enough to allow
  the standard suffixes.
- **The `attachmentRowToPayload` schema drift check** (`safeParse`
  against `AttachmentPayloadSchema`) is the canonical pattern —
  catches future column renames that weren't tracked here. The
  choice of `safeParse` over `parse` is correct (a malformed mock
  doesn't crash the response; production rows always have valid
  UUIDs). Preserved.
- **The lazy `ensureRepo` + `ensureIncidentFindUnique` pattern** in
  `routerWiring.ts` mirrors `notifications/routerWiring.ts` —
  allows the api to boot without `DATABASE_URL` set. The re-throw
  in `ensureIncidentFindUnique`'s catch is correct: the router's
  per-handler catch surfaces 500 on the thrown error; a swallow
  would mask a DB outage. Preserved.
- **The DELETE response `204 No Content`** is correct for a
  successful resource removal.
- **The DELETE route is on `/api/attachments/:id`** (NOT
  `/api/incidents/:id/attachments/:id`) because the id is globally
  unique — no need to thread the incident id. Correct.

### Out of scope

- `attachmentRepository.spec.ts`, `attachmentRouter.spec.ts` —
  spec files. Not edited.

## Plan

### Strip pass (all 5 files)

1. **Drop every `Story 4.13` reference** from headers and inline
   rationale.
2. **Drop cross-file mirror references** (`Mirrors
notificationRowToPayload.ts (4.10)`, `Mirrors
incidentStateRepository.ts (4.2)`, etc.) — the convention is in
   the source.
3. **Drop the "Why a separate file" / "Why a dedicated module"
   bullet lists** — restate the convention.
4. **Drop the "future story adds a second router" speculative
   prose** — current code IS the truth.
5. **Drop the "src/index.ts is near max-lines" reference** — git
   tracks the move.
6. **Drop the DUPLICATE header in `attachmentRepository.ts`**
   (P1-1) — keep ONE 4-line header.

### Trim pass (file headers + function-level rationales)

7. **`attachmentRepository.ts`**: 26 lines of duplicated header →
   4 lines. Total file 88 → ~66 LOC.
8. **`attachmentRepository.ts:28-33`** (row shape preamble): 6
   lines → 1 line.
9. **`attachmentRepository.ts:44-55`** (slice interface preamble):
   12 lines → 2 lines.
10. **`attachmentRepository.ts:76-79`** (resolveX preamble): 4
    lines → 1 line.
11. **`attachmentRepository.ts:82-87`** (production cast note): 6
    lines → 1 line.
12. **`attachmentRowToPayload.ts` header**: 14 lines → 4 lines.
13. **`attachmentRowToPayload.ts:29-35`** (safeParse rationale): 7
    lines → 2 lines. Total file 41 → ~36 LOC.
14. **`attachmentRouter.ts` header**: 11 lines → 6 lines. (Already
    concise — the route list IS the file purpose.)
15. **`attachmentRouter.ts:50-53`** (`incidentFindUnique` JSDoc): 4
    lines → 1 line.
16. **`attachmentRouter.ts:76-77`** (delete ownership preamble): 2
    lines → 1 line.
17. **`attachmentRouter.ts:102-103`** (tech ownership preamble): 2
    lines → 1 line.
18. **`attachmentRouter.ts:192-194`** (MIME precedence): 3 lines →
    1 line.
19. **`routerWiring.ts` header**: 24 lines → 6 lines.
20. **`routerWiring.ts:76-79`** (re-throw rationale): 4 lines → 1
    line. Total file 113 → ~97 LOC.
21. **`index.ts` header**: 20 lines → 4 lines. Total file 31 → ~15
    LOC.

### Preserved (load-bearing)

- The narrow-slice `AttachmentRepository` interface (4 methods:
  `create`, `findMany`, `findUnique`, `delete`).
- The `AttachmentRouterDeps` shape (`audit`, `repo`,
  `incidentFindUnique`) — the seam that keeps the router
  decoupled from the full incident state machine.
- The `validateUrlOrRespond` security boundary (rejects
  `javascript:` / `data:` / `file:` / `vbscript:` / relative paths
  via `@surakkha/shared/urlValidation`).
- The MIME precedence chain (user override → URL extension → fallback).
- The RBAC matrix: Admin bypass; original uploader bypass;
  Operator/Technician-else → 403 on DELETE. Admin/Operator/Viewer
  skip on POST/GET; Technician requires `assigneeUserId === user.id`.
- The audit emit ordering (BEFORE the 403 response in both RBAC
  helpers).
- The DELETE route path (`/api/attachments/:id`, not under
  `/api/incidents/:id/...`) — the id is globally unique.
- The `safeParse` schema-drift check in `attachmentRowToPayload`.
- The lazy `ensureRepo` + `ensureIncidentFindUnique` boot pattern.
- The re-throw on `incidentFindUnique` failure (so the router's
  per-handler catch surfaces 500, not a swallowed error).
- The Zod `createBodySchema` strictness (URL required, label ≤200,
  MIME regex `^[a-z]+/[a-z0-9.+-]+$`).

## Verification

```bash
npx --prefix packages/api tsc -b packages/api
npx --prefix packages/api eslint packages/api/src/attachments
cd packages/api && npx vitest run src/attachments 2>&1 | tail -15
node scripts/lint-prose.mjs
```

Existing specs (must stay green):

- `attachmentRepository.spec.ts` — slice adapter + lazy throw
- `attachmentRouter.spec.ts` — POST + GET + DELETE full coverage
