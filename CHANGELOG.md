# Changelog

All notable changes to Surakkha are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning 2.0.0](https://semver.org/).

---

## [Unreleased]

### Added

- Initial planning artefacts (PRD, BRD, idea-refined, architecture).
- 55-story epic breakdown across 6 epics + Step 0 Foundation Seam. See [`_bmad-output/planning-artifacts/epics.md`](./_bmad-output/planning-artifacts/epics.md).
- UX spine pair (`DESIGN.md` + `EXPERIENCE.md`) and 6 promoted key-screen mocks for the 2026-08-20 run.
- Implementation-readiness gate v2 returns **READY** with 100% FR / NFR / AR / UX-DR coverage. See [`_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-20-v2.md`](./_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-20-v2.md).
- `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- `docs/demo-script.md` (Story 6.8).
- `docs/architecture-appendix-opconstraints.md` (Story 6.7) — operational constraints I-9..I-15 with "do not mistake for durable" warnings.
- `docs/architecture-appendix-rbac.md` (Story 1.1) — full role × action × resource matrix.
- GitHub issue and PR templates; CI workflow stub.

### Changed

- None yet — pre-implementation.

### Deprecated

- None yet — pre-implementation.

### Removed

- None yet — pre-implementation.

### Fixed

- None yet — pre-implementation.

### Security

- None yet — pre-implementation.

---

## Versioning note

Until the first tagged release (`1.0.0`), the project is in pre-implementation state. The current target is `0.1.0-planning`. Each implementation slice (PRD §6) will receive its own entry here as it lands.

| Slice | Name                  | Stories                                                                              | Status     |
|-------|-----------------------|--------------------------------------------------------------------------------------|------------|
| 0     | Step 0 Foundation     | F-0.1..F-0.5 (monorepo, shared package, ESLint, Compose, README)                      | Pending    |
| 1     | Skeleton              | F-0.1..F-0.5 + the runnable Compose stack                                            | Pending    |
| 2     | Wire contract         | 2.1, 2.2, 2.3, 2.4, 2.5                                                              | Pending    |
| 3     | Rules + alerts        | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7                                                     | Pending    |
| 4     | Incidents + workflow  | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13                  | Pending    |
| 5     | Dashboard + sensors   | 2.6, 2.7, 2.8, 2.9 + the executive dashboard region                                   | Pending    |
| 6     | Admin surface         | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6                                                          | Pending    |
| 7     | Auth + RBAC           | 1.1, 1.2a, 1.2b, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10                              | Pending    |
| 8     | E2E + polish          | 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9                                          | Pending    |

(Slice 5 reuses stories from Epic 2 because the dashboard regions consume the same wire contract; slice 7 reuses stories from Epic 1 because the auth domain is the foundation. The PRD §6 plan and the epic breakdown are sequenced for delivery, not for one-to-one mapping.)