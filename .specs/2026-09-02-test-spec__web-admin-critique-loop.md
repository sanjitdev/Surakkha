# Test spec — `packages/web/src/admin` critique loop (2026-09-02)

## Scope

Regression pins for the 2026-09-02 `/impeccable critique packages/web/src/admin` loop. All assertions below MUST hold after every future change to the surface; failure to satisfy any pin reopens the loop.

Critique artifact: `.impeccable/critique/2026-09-02T18-00-00Z__packages-web-src-admin.md`. Score: **32/40**. Two P1 fixes (story-internal jargon in 7 headers; `Object.assign(wrapped, detail)` mutation hack) and five P2 fixes (5 near-identical `safeParse+log+throw` blocks; 4 mutation-toast wiring blocks; 19-line EditRuleModal JSDoc; missing `SIMULATOR_*_KEY` constants; mid-file useEffect JSDoc) shipped in this PR.

## Behavioural pins (UI / RTL)

### ThresholdsPage

| #   | Given                                         | When                       | Then                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Page mounts, no rules                         | Initial render             | `data-testid="thresholds-page-loading"` visible                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | Page mounts, api returns 500                  | Initial render             | `data-testid="thresholds-page-error"` + Retry button visible                                                                                                                                                                                                                                                                                                                                                       |
| 3   | Page mounts, api returns `[]`                 | Initial render             | `data-testid="thresholds-table"` + `data-testid="thresholds-empty"` row ("No thresholds yet.")                                                                                                                                                                                                                                                                                                                     |
| 4   | 3 active rules, 2 inactive                    | Toggle "Show history" off  | `visible.length === 3`; `thresholds-active-count` reads "3 active"; `thresholds-history-summary` NOT rendered                                                                                                                                                                                                                                                                                                      |
| 5   | 3 active rules, 2 inactive                    | Toggle "Show history" on   | `visible.length === 5`; `thresholds-history-summary` reads "2 inactive versions in history."                                                                                                                                                                                                                                                                                                                       |
| 6   | 1 inactive rule                               | Toggle "Show history" on   | `thresholds-history-summary` reads "1 inactive version in history." (singular)                                                                                                                                                                                                                                                                                                                                     |
| 7   | Rule row with `isActive === true`             | Render                     | Edit + Deactivate buttons visible; Activate button absent                                                                                                                                                                                                                                                                                                                                                          |
| 8   | Rule row with `isActive === false`            | Render                     | Edit + Activate buttons visible; Deactivate button absent                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Active rule row                               | Click Deactivate           | `updateMutation` invoked with `{ id, body: { activate: false } }`; success toast "Rule deactivated."                                                                                                                                                                                                                                                                                                               |
| 10  | Inactive rule row                             | Click Activate             | `activateMutation` invoked with `{ id }`; success toast "Rule activated."                                                                                                                                                                                                                                                                                                                                          |
| 11  | Click "New Rule"                              | Modal opens                | `data-testid="thresholds-new-rule-modal"` visible; Device ID / Metric / Operator / Threshold / Severity / Rule type / Min duration / Hysteresis fields present                                                                                                                                                                                                                                                     |
| 12  | New Rule modal, valid numeric inputs          | Click Create               | `createMutation` invoked with parsed `{ threshold, minDurationSeconds, hysteresisSeconds }` as numbers; success toast "Rule created."                                                                                                                                                                                                                                                                              |
| 13  | New Rule modal, threshold = "abc"             | Click Create               | `createMutation` NOT invoked; error toast "Invalid numeric field." (parse-numeric guard)                                                                                                                                                                                                                                                                                                                           |
| 14  | New Rule modal, Device ID = ""                | Submit                     | api body has `deviceId: null` (global rule)                                                                                                                                                                                                                                                                                                                                                                        |
| 15  | New Rule modal, Device ID = "dev-1"           | Submit                     | api body has `deviceId: "dev-1"` (device-scoped rule)                                                                                                                                                                                                                                                                                                                                                              |
| 16  | Active rule row                               | Click Edit                 | `data-testid="thresholds-edit-modal"` opens with `aria-label` containing rule id                                                                                                                                                                                                                                                                                                                                   |
| 17  | Edit modal, pre-fill                          | Render                     | `thresholds-edit-field-deviceId` shows `rule.deviceId ?? "global"`; `thresholds-edit-field-severity` shows `rule.severity`; `thresholds-edit-field-ruleType` shows `rule.ruleType`; `thresholds-edit-field-metric` + `thresholds-edit-field-operator` + `thresholds-edit-field-minDurationSeconds` + `thresholds-edit-field-hysteresisSeconds` are inside a `<details data-testid="thresholds-edit-other-fields">` |
| 18  | Edit modal                                    | Toggle "More rule details" | The 4 secondary fields become visible (progressive disclosure)                                                                                                                                                                                                                                                                                                                                                     |
| 19  | Edit modal, threshold = "5.5"                 | Click Supersede            | `updateMutation` invoked with `{ id, body: { supersede: true, threshold: 5.5 } }`; on `result.kind === "supersede"` success, toast reads `"Rule superseded (v{next.version})."`; on `result.kind === "deactivate"`, toast reads `"Rule deactivated."`                                                                                                                                                              |
| 20  | Edit modal, threshold = "" (NaN)              | Click Supersede            | Mutation NOT invoked; modal stays open (silent rejection — no-op)                                                                                                                                                                                                                                                                                                                                                  |
| 21  | All 4 mutations: api 4xx                      | Response                   | Error toast formatted as `"<errorPrefix>: <err.message>"` (delegates to `onMutation(pushToast, successMsg, errorPrefix)` helper)                                                                                                                                                                                                                                                                                   |
| 22  | Create / Update / Activate mutations: success | Response                   | `["admin", "thresholds", "rules"]` query key invalidated; page refetches                                                                                                                                                                                                                                                                                                                                           |

### SimulatorPage

| #   | Given                                                   | When                                     | Then                                                                                                                                           |
| --- | ------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 23  | Page mounts                                             | Both queries loading                     | `data-testid="simulator-page-loading"` visible                                                                                                 |
| 24  | Status returns `{ enabled: false }`                     | Render                                   | `data-testid="simulator-page-disabled"` + `DisabledBanner` visible; device list NOT rendered                                                   |
| 25  | Status returns 500                                      | Render                                   | `data-testid="simulator-page-status-error"` visible ("Failed to load simulator status. Reload the page.")                                      |
| 26  | Status ok, devices query 500                            | Render                                   | `data-testid="simulator-page-error"` + Retry button visible                                                                                    |
| 27  | Status ok, devices query 401/403                        | Render                                   | The status query is invalidated (the `<DisabledBanner>` wins over the devices error on next paint)                                             |
| 28  | 6 devices                                               | Render                                   | `simulator-device-count` reads "6 devices"                                                                                                     |
| 29  | 1 device                                                | Render                                   | `simulator-device-count` reads "1 device" (singular)                                                                                           |
| 30  | Device row, status ok                                   | Click Switch with same scenario as badge | Mutation NOT invoked (no-op short-circuit)                                                                                                     |
| 31  | Device row, status ok                                   | Click Switch with different scenario     | `useSwitchScenario` invoked with `{ deviceId, scenario: selected, paused: <current paused value> }`; success toast `"Switched to <scenario>."` |
| 32  | Device row, Pause toggled off                           | Click Pause                              | Mutation invoked with `{ deviceId, paused: true }`; on success, local `paused` state flips; toast reads "Paused."                              |
| 33  | Device row, Pause toggled on, mutation fails            | Click Pause                              | Local `paused` state does NOT flip (deferred to onSuccess)                                                                                     |
| 34  | Device row, mutation fails with `secret_mismatch`       | Response                                 | Status query refetched; toast "Simulator disabled."                                                                                            |
| 35  | Device row, mutation fails with `simulator_unreachable` | Response                                 | Status query refetched; toast "Simulator unreachable."                                                                                         |
| 36  | Device row, mutation fails with `switch_in_progress`    | Response                                 | Toast "Another switch is in progress."                                                                                                         |
| 37  | Device row, mutation fails with `validation_error`      | Response                                 | Toast "Switch failed: invalid input."                                                                                                          |
| 38  | Device row, mutation fails with unknown 4xx/5xx         | Response                                 | Toast `"Switch failed (<status>)."`                                                                                                            |

## Hook pins (unit / RTL)

### `useThresholds`

| #   | Given                                                 | When                                                                        | Then                                                                                                |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 39  | api returns malformed list response                   | `useThresholds(false).refetch()`                                            | Throws `Error("thresholds wire-shape mismatch")`; `console.error` called with that label + ZodError |
| 40  | api returns valid list                                | refetch                                                                     | Returns `parsed.data` (no throw)                                                                    |
| 41  | api returns malformed row on POST                     | `useCreateThreshold().mutate(body)`                                         | Throws `Error("create threshold wire-shape mismatch")`                                              |
| 42  | api returns valid row on POST                         | mutate                                                                      | Returns `RuleRow`; `["admin", "thresholds", "rules"]` invalidated on success                        |
| 43  | api returns malformed supersede envelope              | `useUpdateThreshold().mutate({ id, body: { supersede: true, threshold } })` | Throws `Error("supersede wire-shape mismatch")`                                                     |
| 44  | api returns valid supersede envelope                  | mutate                                                                      | Returns `{ kind: "supersede", old, next }`; rules key invalidated                                   |
| 45  | api returns malformed row on deactivate               | mutate with `{ activate: false }`                                           | Throws `Error("deactivate wire-shape mismatch")`                                                    |
| 46  | api returns valid row on deactivate                   | mutate                                                                      | Returns `{ kind: "deactivate", row }`; rules key invalidated                                        |
| 47  | api returns malformed row on activate                 | `useActivateThreshold().mutate({ id })`                                     | Throws `Error("activate threshold wire-shape mismatch")`                                            |
| 48  | api returns valid row on activate                     | mutate                                                                      | Returns `RuleRow`; rules key invalidated                                                            |
| 49  | api returns 400 + `validation_error` body with issues | Any mutation                                                                | Error message = `"<label> failed: 400 — <path>: <message>; ..."`                                    |
| 50  | api returns 500 + `{ error: "..." }`                  | Any mutation                                                                | Error message = `"<label> failed: 500 — <error-code>"`                                              |
| 51  | api returns 500 + non-JSON                            | Any mutation                                                                | Error message = `"<label> failed: 500 (no body)"`                                                   |

### `useSimulatorDevices`

| #   | Given                                           | When   | Then                                                                                                           |
| --- | ----------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 52  | `useSimulatorStatus`                            | Mount  | Query key `SIMULATOR_STATUS_KEY` (a `readonly ["admin", "simulator", "status"]` tuple); `enabled` field parsed |
| 53  | `useSimulatorDevices`                           | Mount  | Query key `SIMULATOR_DEVICES_KEY` (a `readonly ["admin", "simulator", "devices"]` tuple)                       |
| 54  | Switch mutation, api 401                        | mutate | Throws `{ kind: "secret_mismatch" }` (no detail copy)                                                          |
| 55  | Switch mutation, api 503 + `{ disabled: true }` | mutate | Throws `{ kind: "secret_mismatch" }`                                                                           |
| 56  | Switch mutation, api 400                        | mutate | Throws `{ kind: "validation_error" }`                                                                          |
| 57  | Switch mutation, api 409                        | mutate | Throws `{ kind: "switch_in_progress" }`                                                                        |
| 58  | Switch mutation, api 502                        | mutate | Throws `{ kind: "simulator_unreachable" }`                                                                     |
| 59  | Switch mutation, api 418                        | mutate | Throws `{ kind: "unknown", status: 418 }`                                                                      |

### `DeviceRow`

| #   | Given                                                     | When             | Then                                                                                             |
| --- | --------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| 60  | Mutation in flight (any row)                              | Any button click | Buttons render with `disabled` attribute                                                         |
| 61  | Parent invalidates device list with new `device.scenario` | Re-render        | Local `selected` state syncs to `device.scenario ?? "Normal"` (no stale `selected` disagreement) |
| 62  | Switch clicked with `paused` state                        | Mutation fires   | Request body has `paused` bundled so device can't end up "stuck paused"                          |
| 63  | Scenario + paused both match current state                | Switch click     | Mutation NOT invoked (no-op short-circuit)                                                       |

### `ThresholdsModals`

| #   | Given                                    | When            | Then                                                                                                                               |
| --- | ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 64  | `EditRuleModal` with any rule            | Render          | `aria-label="Edit rule {rule.id}"`; one-line heading with metric / operator / threshold                                            |
| 65  | `EditRuleModal`                          | Render          | A `<details data-testid="thresholds-edit-other-fields">` wraps the 4 secondary fields (metric, operator, min-duration, hysteresis) |
| 66  | `EditRuleModal`, threshold input = "abc" | Click Supersede | `onSubmit` NOT invoked (Number.isNaN guard)                                                                                        |
| 67  | `NewRuleModal`                           | Render          | All 8 fields pre-populated from `emptyNewRuleForm` defaults                                                                        |

## Static / lint pins

| #   | Property                                                                        | Required value                                                                                                                      |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 68  | `useThresholds.ts` line count                                                   | ≤ 200 (lint cap `max-lines-per-function` is per-function, not per-file; file can grow)                                              |
| 69  | `useThresholds.ts` `safeParse + console.error + throw` block count              | Exactly **1** (the shared `assertWireShape<T>` helper). Pre-loop: 5                                                                 |
| 70  | `useSimulatorDevices.ts` `Object.assign(wrapped, detail)` occurrences           | **0**. Pre-loop: 1                                                                                                                  |
| 71  | `useSimulatorDevices.ts` query-key tuple constants                              | `SIMULATOR_STATUS_KEY` and `SIMULATOR_DEVICES_KEY` are exported as `as const` tuples                                                |
| 72  | `ThresholdsPage.tsx` `mutation.mutate(..., { onSuccess, onError })` block count | **1** (the supersede block; the other 3 use the `onMutation(pushToast, successMsg, errorPrefix)` helper). Pre-loop: 4               |
| 73  | `ThresholdsModals.tsx` `EditRuleModal` JSDoc block                              | ≤ 6 lines. Pre-loop: 19 lines                                                                                                       |
| 74  | All admin/ file headers                                                         | No story-internal jargon (`G3-01`, `F-2.5-17`, etc.); no progressive-disclosure self-critique markers                               |
| 75  | `DeviceRow.tsx` header                                                          | ≤ 8 lines. Pre-loop: 21 lines                                                                                                       |
| 76  | `SimulatorPage.tsx` mid-file `useEffect` JSDoc                                  | ≤ 4 lines. Pre-loop: 11 lines                                                                                                       |
| 77  | `useThresholds.ts` `useRef` for idempotency key                                 | **Not required** (thresholds mutations are not in the transition 5; idempotency-key middleware is the transition surface's concern) |

## Negative pins (regression guards)

| #   | Behaviour                                           | Must NOT happen                                                                                                                                        |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 78  | `useSimulatorDevices` switch failure classification | Throw a generic `Error("...")` — must throw the typed `SwitchScenarioError` discriminated union directly                                               |
| 79  | `useThresholds` wire-shape mismatch                 | Throw a bare `new Error("ZodError")` — must throw with the operation label so operators see WHICH call failed                                          |
| 80  | `ThresholdsPage` mutation wiring                    | Inline `{ onSuccess, onError }` blocks per mutation (4x) — must consolidate to `onMutation(pushToast, successMsg, errorPrefix)` for the 3 simple cases |
| 81  | `EditRuleModal` modal render                        | Surface all 7 immutable fields inline — must group into key-identity summary + `<details>` disclosure                                                  |
| 82  | Admin/ file headers                                 | Contain `G3-*` or `F-2.5-*` references (these are story-internal codes; readers outside the dev context can't decode them)                             |

## Verification commands

```bash
# TypeScript
cd packages/web && npx tsc -b

# Lint (full surface)
cd packages/web && npx eslint src/admin

# Tests
cd packages/web && npx vitest run

# Manual double-tap (already in simulator/ specs — applies here only for the
# mutation hooks; the api-level replay is verified at the api side).
```

## Acceptance

This PR is acceptable iff pins 1–82 all hold. Pin 73 in particular caps the `EditRuleModal` JSDoc at 6 lines (down from 19) — the prior block contained a self-critique narrative (`Critique 2026-08-31 progressive-disclosure finding`) that belonged in the critique artifact, not the source.
