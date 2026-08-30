# `_archive/` — superseded review artifacts

This directory holds pre-convention review work product that has been
superseded by the canonical `review-N-M-verification-gap.md` files
in the parent directory.

## What lived here

These `review-target-4-*.patch` files were the working drafts from
the Step-04 review process for Epic 4 stories 4.4, 4.6, 4.7, 4.8,
and 4.10. They predate the formal review doc convention that started
with Story 4.11.

| Archived file              | Story                                        | Canonical review doc (parent dir)                                            |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `review-target-4-4.patch`  | 4.4 (Incident Detail Page)                   | (none — 4.4 predates the convention; review work captured in commit history) |
| `review-target-4-6.patch`  | 4.6 (Assign Technician)                      | (none — same)                                                                |
| `review-target-4-7.patch`  | 4.7 (Submit Result + SAFE/UNSAFE/MONITORING) | `review-4-7-verification-gap.md`                                             |
| `review-target-4-8.patch`  | 4.8 (Sticky SeverityBanner)                  | `review-4-8-verification-gap.md`                                             |
| `review-target-4-10.patch` | 4.10 (NotificationBell)                      | `review-4-10-verification-gap.md`                                            |

## Why archived, not deleted

The content of each patch is the raw diff captured at review time —
useful as historical evidence if a regression question ever surfaces
("what did we change in 4.7?"). The canonical review doc is the
distilled semantic record; the patch is the bit-level record.

Both forms are recoverable from `git log -p` for the corresponding
commits — these files are kept on disk purely to avoid having to
replay history for casual reference.

## Active review docs in the parent directory

The four canonical review files (4.7, 4.8, 4.10, 4.11, 4.12) follow
the structure established by `review-4-11-verification-gap.md`:

- Source attribution (spec Change Log Loop 0 / Loop 1).
- Reviewer roster (blind-hunter + edge-case-hunter + verification-gap).
- Per-finding pin table with severity + surface + resolution.
- Spec-amendment table (intent-gap corrections vs. mechanical fixes).
- "KEEP for next reviewer" load-bearing-seams section.
- Verification re-run notes.

## See also

- `_bmad-output/implementation-artifacts/sprint-status.yaml` — the
  active ledger; `review:` field on each story points at the
  canonical review doc, never at these archived patches.
