---
target: packages/web/src/audit-log/
total_score: 34
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
timestamp: 2026-09-01T11-33-17Z
slug: packages-web-src-audit-log-auditlogpage-tsx
---

## Story 5.3 — /impeccable critique packages/web/audit-log/

**Method:** Dual assessment — A (LLM design review): a4be69174094214ae · B (deterministic detector): clean
**Target:** packages/web/src/audit-log/ + modified main.tsx:266 + nav.ts:58
**Score:** 34 / 40 (85%) — Band: Strong
**Trend for packages-web-audit:** 28 → 32 (this run). First scored run for this slug; previous entry was a partial sketch.

### Design Specificity Verdict

Strongly authored for Surakkha. This is not a category-interchangeable admin audit log. Concrete signals: filter vocabulary (actor, event, resource) is the audit-log-specific projection from the new Prisma AuditLog model; 13-chip resource row (Simulator, SeverityBanner, Attachment, School, etc.) is meaningless outside this app; entity links route to Surakkha destinations (/incidents/{id}, /admin/thresholds?rule_id={id}), not placeholder hrefs; empty-state copy distinguishes "writer not yet shipped" (5.6 pending) from "no rows match filter"; outcome pill reuses the severity token vocabulary; polling mirrors 4.10/5.1/5.2 cadence.

### Design Health Score

| #     | Heuristic                                           | Score   | Key Issue                                                                                                                                                           |
| ----- | --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Visibility of System Status                         | 3       | Loading/empty/error all surface; truncated summary says "Showing 1 of 250+"; in-flight 30s refetch invisible (no "new since" pulse)                                 |
| 2     | Match System / Real World                           | 4       | Vocabulary matches Prisma model + RBAC matrix; outcome pill mirrors severity; ISO-8601 with no locale theatre                                                       |
| 3     | User Control and Freedom                            | 3       | Custom range disabled with aria-describedby; chips removable; no Reset All                                                                                          |
| 4     | Consistency and Standards                           | 4       | Mirrors AdminNotificationsPage structurally; no split-brain tokens; no inline hex                                                                                   |
| 5     | Error Prevention                                    | 4       | UUID regex on resourceId (anti-XSS), actor-input UUID validator, circular JSON.stringify try/catch                                                                  |
| 6     | Recognition Rather Than Recall                      | 3       | All sections headed; aria-pressed chips; actor column shows raw 8-char UUID (same P2 finding from 2026-08-31 critique on IncidentDetailPage.formatActorOrAnonymous) |
| 7     | Flexibility and Efficiency of Use                   | 3       | 30s polling, multi-select chips, free-text event, three date presets; no keyboard shortcut to clear filters; no URL-driven initial state                            |
| 8     | Aesthetic and Minimalist Design                     | 4       | Honest density; severity tokens only saturated palette; ONE ASCII `...` lapse on loading copy                                                                       |
| 9     | Help Users Recognize, Diagnose, Recover from Errors | 3       | RbacDenied renders with role-aware back-link; "Unable to load audit log. Retry shortly." has no Retry button                                                        |
| 10    | Help and Documentation                              | 2       | Page ships zero inline guidance; no "what is an audit event" primer                                                                                                 |
| Total |                                                     | 34 / 40 | Strong (85%)                                                                                                                                                        |

### Deterministic Scan

`node .claude/skills/impeccable/scripts/detect.mjs --json packages/web/src/audit-log/ packages/web/src/main.tsx packages/web/src/shell/nav.ts` → clean (zero findings). No inline hex literals, no shadcn/Radix/CVA references, no Inter-as-decorative, no card-shadow-overuse, no side-tab patterns. The hex-rule, prose-lint, and eslint-plugin-tailwindcss gates installed in prior chore(impeccable) rounds caught everything at file-edit time. All four resolved P0/P1 categories from 2026-08-31 (token split-brain, JIT misses, touch-targets, copy) hold — no regression.

### What's Working

- AuditLogPage.tsx:243-245 + main.tsx:266-282 — defense-in-depth RBAC layering. Route-level RbacRoute short-circuits non-Admin path; page-level instanceof AdminAuditLogRbacDeniedError fallback catches rare mid-session token expiry. Identical pattern to AdminNotificationsPage, but the new sibling tagged error class keeps the two surfaces' error contracts independent.
- useAuditLogList.ts:149-153 + 181-189 — sliding since window. Resolves wire-level since from preset per-fetch (not per-mount), so lower bound slides forward during 30s polling. Same Loop-2 hardening the notification surface uses.
- AuditLogPage.tsx:146-162 + 275-282 — defense at URL boundary. UUID regex guard on resourceId (anti-XSS) and inline UUID validation on actor input.

### Priority Issues

- P1 — Empty state has no next-action CTA [AuditLogPage.tsx:534-543]. The empty-state contract (EXPERIENCE.md §Empty) requires a primary CTA alongside the sentence. Today the page renders only the sentence — no anchor to widen the range, no link, no "Why am I seeing this?" disclosure. Why it hurts: An Admin landing between 5.3 and 5.6 ship cannot tell whether the page is broken or by-design. Fix: Default-empty: "No audit events yet. The audit writer ships in a future release — expand the date range to confirm." Filtered-empty: "No audit events match the current filters. Try Last 30d." with a Show last 30d button. Suggested command: /impeccable clarify packages/web/src/audit-log/AuditLogPage.tsx

- P1 — Resource chip row is 14 buttons with no grouping [AuditLogPage.tsx:432-450]. Decision-point overload violates the ≤4 heuristic. The 13 enum members are flat. Why it hurts: Admin cannot scan — finding SeverityBanner among 13 horizontal pills is hunt-and-peck. Fix: Two visual rows with mini-headings — "Domain entities" (Incident, Alert, Reading, Device, User, School, Rule) and "Platform events" (Notification, Simulator, SeverityBanner, Attachment, Session, Other). Suggested command: /impeccable adapt packages/web/src/audit-log/AuditLogPage.tsx

- P2 — Actor column shows raw 8-char UUIDs [AuditLogPage.tsx:584-585]. The 2026-08-31 critique flagged this exact anti-pattern in IncidentDetailPage.formatActorOrAnonymous. The new page repeats it: row.actorUserId === null ? "system" : row.actorUserId.slice(0, ID_SHORT_PREFIX_LENGTH). Why it hurts: Admin scanning 100 rows sees a column of c1111111, 7d8e9f0a, f4a1c2b3 — noise, not signal. Fix: Render actorLabel = row.payload?.actorRole ?? row.actorUserId?.slice(0, 8) ?? "system" for now; add a TODO naming the 5.6 writer-swap follow-up. Suggested command: /impeccable clarify packages/web/src/audit-log/AuditLogPage.tsx

- P2 — Error fallback has no Retry button [AuditLogPage.tsx:527-533]. "Unable to load audit log. Retry shortly." is a status, not an action. TanStack Query exposes query.refetch() for free. Why it hurts: A transient 5xx leaves the Admin waiting for the 30s poll. Fix: Render a small Retry button that calls query.refetch(). Suggested command: /impeccable simplify packages/web/src/audit-log/AuditLogPage.tsx

- P3 — Loading copy uses ASCII `...` while the project has settled on `…` [AuditLogPage.tsx:523]. The 2026-08-31 critique's minor #5 specifically called this out for IncidentDetailActions.tsx:173/258/360/463. Fix: Change `Loading audit log...` → `Loading audit log…` (U+2026). Suggested command: /impeccable polish packages/web/src/audit-log/AuditLogPage.tsx

### Persona Red Flags

Sanjit (Admin, demo-driver — EXPERIENCE.md F6/F3/F8): Opens /audit to verify the trail end-to-end. First paint says "No audit events yet." He has no way to confirm this is expected vs broken — no "writer ships in a future release" hint. The chip row is 14 buttons wide on a 1280px display and he cannot find SeverityBanner without scanning every label. He clicks a row seeded with resource: "Incident", expands it, clicks "View incident" — lands on /incidents/{id} cleanly (the F8 climax). What breaks: Confidence at first paint (no CTA, no "by-design" anchor); efficiency on the resource chip row (no grouping).

Rahim (Operator, on-call — EXPERIENCE.md F1/F2/F8): /audit is correctly hidden from his sidebar (nav.ts:58 does its job). If a regulator asks "who acknowledged incident X at 14:32 yesterday?" Rahim cannot self-serve — he must ask Sanjit. This is the intended RBAC posture, but the sub-head line reads as "you can browse the trail here" to a role who just discovered /audit exists. What breaks: Nothing today (correctly hidden), but the sub-head copy would mislead if a future RBAC matrix change widens access without re-revising the intro. Defensive fix: Tighten the sub-head to "Admin-only audit trail — read-only record of every audit emit across the platform."

### Minor Observations

- AuditLogPage.tsx:212-232 — useMemo body re-assembles filter object via repeated `(out as { ... }).field = value` casts. An accumulator-style helper would read cleaner; the casts are a code-smell future maintainers will misread as bugs.
- useAuditLogList.ts:73-77 — PRESET_WINDOW_MS is declared in BOTH the page and the hook (constant duplication). One shared export from @surakkha/shared/audit would remove the brittle invariant.
- AuditLogPage.tsx:546-549 — summary copy pluralises correctly but does not include the date window in the visible string. Adding `…in the last 30d` when the preset is non-default would let the Admin confirm the filter at a glance.

### Provocative Questions

1. What if the date-range filter became a single "Last 30d ▾" dropdown? Saves vertical real estate and lets the 14-button resource row breathe. Tradeoff: dropdowns cost a click; chip row is the project's filter language.
2. Should the empty state invite the Admin to trigger a writer (since 5.6 has not shipped yet)? A Simulator link on the default-empty state would turn the dead end into a teaching moment. Tradeoff: leaks implementation detail into copy.
3. What if the resource chip row were a multi-select? Wire already supports repeated params. Multi-select matches the severity-chip vocabulary from AdminNotificationsPage.
4. What if the table rendered a single visible audit "subject" column (e.g., for incident_state_changed, surface {from: OPEN, to: ACKNOWLEDGED} as a sentence inline) instead of deferring every payload shape to the JSON <pre>? Kanban formatTimelineEventSummary precedent shows the team knows how to do this prose-first.
