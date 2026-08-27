# Story 4.1 — IncidentCard Type Contract

**Status:** done (lands with Epic 4 foundation slice)
**Epic:** 4 — Incidents & Workflow
**Covers:** UX-DR-9 (contract portion)
**Review loop:** 0 (pure types, no rendering; loopbacks reduce as scope narrows)
**Shipped:** 2026-08-27 (Epic 4 foundation slice)

---

## Context

Epic 4's user-facing surface is built around the `IncidentCard` — a single card primitive that both Epic 2's read-only incident preview and Epic 4's interactive workflow consume. To prevent drift between read-only and interactive surfaces, the **action affordances** must be derived from the underlying `Incident.state` (never the column name), and the **availability** of each affordance must be derived from the viewer's RBAC role.

Story 4.1 establishes the **type contract only** — the actual `<IncidentCard />` React component ships in Story 4.4 (deferred to next sweep). The pure types land now so that the deferred stories can consume them without retroactive drift. This is the Epic 4 equivalent of how Stories 3.1 (schema) and 3.2 (engine) were split: contract first, implementation second.

## User Story

> As a developer, I want a locked `IncidentCard` contract whose action slots are computed from the underlying state (never the column), so that Epic 2's read-only incident preview and Epic 4's interactive workflow consume the same affordance.

## Acceptance Criteria

| AC   | Description                                                                                                                                                                                                                                                                                                                                              | Pin                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AC1  | `packages/web/src/components/IncidentCard.types.ts` exists and exports: (a) `ActionSlot` type (a literal union of action identifiers), (b) `IncidentCardProps` interface, (c) `actionSlotsFor(incident, role): readonly ActionSlot[]` pure helper.                                                                                                       | File exists; barrel re-export from `components/index.ts`.  |
| AC2  | `ActionSlot` is exported as a _literal union_ of valid action ids: `"acknowledge" \| "assign" \| "submit-result" \| "resolve" \| "reopen" \| null`. The `null` member is reserved for the "no action available" state (used by Epic 2's read-only preview, deferred UI work).                                                                            | TS literal-narrowing test in `IncidentCard.types.spec.ts`. |
| AC3  | `IncidentCardProps` has exactly the shape `{ incident: Incident; onAction: (slot: ActionSlot) => void; isInteractive: boolean }`. `onAction` is only invoked when `isInteractive === true`.                                                                                                                                                              | `toMatchObject` assertion on the type.                     |
| AC4  | `actionSlotsFor(incident, role)` is a **pure** function: same inputs always yield same outputs; no React, no DOM, no fetch. Returns the _non-null_ slots the viewer is allowed to invoke.                                                                                                                                                                | Deterministic test + non-React import surface.             |
| AC5  | For an `incident` in state `OPEN`, an `Operator` calls `actionSlotsFor(incident, "Operator")` and gets `["acknowledge"]`.                                                                                                                                                                                                                                | Spec test.                                                 |
| AC6  | For an `incident` in state `OPEN`, an `Admin` calls `actionSlotsFor(incident, "Admin")` and gets `["acknowledge", "assign"]` (assign is Admin-only at the OPEN step).                                                                                                                                                                                    | Spec test.                                                 |
| AC7  | For an `incident` in state `OPEN`, a `Viewer` calls `actionSlotsFor(incident, "Viewer")` and gets `[]` (no slots — read-only).                                                                                                                                                                                                                           | Spec test.                                                 |
| AC8  | For an `incident` in state `RESOLVED`, an `Admin` calls `actionSlotsFor(incident, "Admin")` and gets `["reopen"]`. A non-Admin (`Operator`/`Technician`/`Viewer`) gets `[]`.                                                                                                                                                                             | Spec test.                                                 |
| AC9  | For an `incident` in state `INSPECTING`, an `Operator` calls `actionSlotsFor(incident, "Operator")` and gets `[]` (the assigned Technician owns the next action; the Operator is read-only at INSPECTING). The assigned Technician gets `["submit-result"]` — the assignment check consumes `incident.assigneeUserId`.                                   | Spec test with assigned + unassigned Technician cases.     |
| AC10 | The slots are derived from `incident.state`, **never** from a column name. The `KanbanColumnSchema` from `@surakkha/shared/incident` does not appear in `IncidentCard.types.ts` — that coupling is intentionally broken at the type level, enforced by a side-effect test that imports the file and asserts no `KanbanColumnSchema` symbol is reachable. | Negative-import test.                                      |

## Out of scope (deferred to other stories)

- The actual `<IncidentCard />` React component — Story 4.4 (Kanban column) and Story 4.5 (Acknowledge UI) deferred to the next Epic 4 sweep.
- Styling (cards live in `packages/web/src/styles/` and consume design tokens from Story 1.2a; not 4.1's job).
- Animations — Story 1.2a tokens cover transition presets.
- ARIA wiring for the buttons — shipped with the component in 4.4.
- The `Incident` wire schema (full row including `assigneeUserId`, `state`, etc.) is owned by Story 4.2's `IncidentPayloadSchema`. 4.1 imports the type from `@surakkha/shared/incident`.

## Code Map

| File                                                     | Change                                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/components/IncidentCard.types.ts`      | NEW — pure types module. `ActionSlot`, `IncidentCardProps`, `actionSlotsFor`. Imports only from `@surakkha/shared/incident` (state enum) and `@surakkha/shared/rbac` (Role). |
| `packages/web/src/components/IncidentCard.types.spec.ts` | NEW — Vitest tests for AC1-AC10. Pure function tests; no React, no DOM. Mounts `actionSlotsFor` directly.                                                                    |
| `packages/web/src/components/index.ts`                   | MODIFY — barrel re-export of `IncidentCard.types.ts` so callers can `import type { IncidentCardProps } from "@/components"` (mirrors `KpiStat` barrel pattern).              |

## Risks / sharp edges

- **`actionSlotsFor` must be a pure function, not a React hook** — Epic 2's read-only preview (`RecentIncidentSummary`) will call it during render. If 4.1 returns a hook, the read-only surface breaks. Mitigation: TS type signature forbids side effects; lint rule `no-react-hooks-in-this-file`.
- **The `assigneeUserId` ownership check (AC9)** requires the `Incident` wire row to carry `assigneeUserId`. The `IncidentPayloadSchema` from Story 4.2 adds that column. 4.1 imports the type from `@surakkha/shared` and tests pass once 4.2 ships.
- **`null` slot literal** — TS literal unions with `null` can be a footgun. 4.1 keeps `null` in the type for Epic 2's read-only preview (which always passes `null` to `onAction`), but `actionSlotsFor` returns `readonly ActionSlot[]` (no nulls) — they're two distinct surfaces.
- **The negative-import test (AC10)** is unusual; it uses a TS compiler hook (`ts.transform`) to assert no `KanbanColumnSchema` import path. If the test infrastructure doesn't support that hook, fall back to a grep-based smoke test in the spec file's setup block.

## Implementation notes (locked)

- The module file is structured as:

  ```ts
  import { type IncidentState } from "@surakkha/shared/incident";
  import { type Role } from "@surakkha/shared/rbac";

  export type ActionSlot = "acknowledge" | "assign" | "submit-result" | "resolve" | "reopen" | null;

  export interface IncidentCardProps {
    readonly incident: Incident;
    readonly onAction: (slot: ActionSlot) => void;
    readonly isInteractive: boolean;
  }

  export const actionSlotsFor = (incident: Incident, role: Role | null): readonly ActionSlot[] => {
    /* switch on incident.state */
  };
  ```

- `Incident` (the full wire row type) is imported from `@surakkha/shared/incident` — added by Story 4.2's `IncidentPayloadSchema`. If 4.2 lands after 4.1, the import is forward-resolved and TS will report "module not found" until then. Mitigation: 4.2's migration spec declares `IncidentPayloadSchema` as a _type-only export_; 4.1's types module references it as a type import (`import type { Incident } from "@surakkha/shared/incident"`), which doesn't fail compile at module-load time.
- The barrel at `components/index.ts` re-exports the type-only barrel:
  ```ts
  export type { ActionSlot, IncidentCardProps } from "./IncidentCard.types";
  export { actionSlotsFor } from "./IncidentCard.types";
  ```

## Verification (after implementation)

- `pnpm -F @surakkha/web test` — green; the new `IncidentCard.types.spec.ts` covers AC1-AC10.
- `pnpm -r typecheck` — no signature drift on cross-package types; the type-only import resolves once 4.2 lands `IncidentPayloadSchema`.
- Manual smoke (optional, since tests cover this): import `actionSlotsFor` in a TS playground with a mock `Incident`, confirm each AC case.
