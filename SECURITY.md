# Security Policy

Surakkha is a real-time water-safety monitoring and incident-management platform. Even in v1, it carries authentication, RBAC, and school + device identity — so security issues are reportable, scoped, and treated seriously.

This document explains how to report a vulnerability, what is supported, and what to expect from the maintainers.

---

## Supported versions

The `main` branch is the only actively supported line. Older tags and historical planning artefacts receive no security backports.

| Version       | Supported      |
|---------------|----------------|
| `main` (HEAD) | Yes            |
| Tagged releases (`1.x.x`, `0.x.x`) | Yes, until the next minor release supersedes them |
| Anything older | No             |

Until `1.0.0` is tagged, the supported line is the latest commit on `main`.

---

## Reporting a vulnerability

**Do not file a public GitHub issue for security vulnerabilities.** Use one of the private channels below.

### Preferred: GitHub private vulnerability reporting

1. Go to the repository's **Security** tab.
2. Click **Advisories** → **New draft security advisory**.
3. Fill in the affected version, summary, and details.
4. Submit as a **private** draft. Maintainers will be notified.

GitHub's private vulnerability reporting keeps the issue hidden from the public until both parties agree to disclose.

### Alternative: e-mail

Send a detailed report to the address listed in the repository's `CODEOWNERS` file or the maintainer's GitHub profile. (If neither is configured for this repo, file the issue via the GitHub Security tab above.)

---

## What to include in a report

A good vulnerability report includes:

- **Summary** — one sentence describing the issue.
- **Affected component** — `api`, `web`, `simulator`, `shared`, `db`, or a specific package or story.
- **Impact** — what an attacker could achieve (auth bypass, data leak, denial of service, escalation).
- **Reproduction steps** — minimal steps or a script. Private repro code is preferred over screenshots.
- **Affected version** — commit SHA, tag, or branch.
- **Environment** — local dev, `docker compose up`, deployed instance, etc.
- **Optional** — suggested fix, related CVEs, prior research.

Reports without a reproduction path may take longer to triage.

---

## What to expect

| Stage               | Response time target |
|---------------------|----------------------|
| Acknowledgement     | Within 7 days of the report. |
| Triage and severity | Within 14 days.     |
| Fix and disclosure  | Coordinated with the reporter; typically within 30 days for critical issues. |

Critical vulnerabilities (auth bypass, RBAC bypass, data exfiltration) are prioritised. Low-severity findings are still triaged but may be deferred to the next release.

---

## Disclosure policy

Surakkha follows **coordinated disclosure**:

1. The reporter submits the vulnerability privately.
2. The maintainers triage, develop a fix, and prepare a release.
3. A release is published with a security advisory.
4. The advisory is published on the public GitHub Security tab.
5. The reporter is credited (unless they request anonymity).

Public disclosure before coordinated disclosure is discouraged. It can leave other users exposed during the window between disclosure and fix.

---

## Security posture of v1

Surakkha v1 ships a small, deliberate security surface:

| Posture                                       | Choice in v1                                                | Rationale                                                                                     |
|-----------------------------------------------|--------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Transport encryption                            | Plain `ws://` (architecture I-14)                            | Local-dev and demo posture. Production deployments terminate TLS at a reverse proxy.         |
| JWT signing                                     | HS256, single secret, no rotation (I-13)                     | Simplicity for a single-process v1. v2 introduces JWKS / RS256 (FR-25, NFR-7).                |
| Password hashing                                | bcrypt cost factor 12 (FR-24)                                | Standard; meets the BRD §8.6 bar.                                                              |
| RBAC                                            | Single `authorize.ts` middleware (Story 1.5)                 | All endpoints enforce `(subject, action, resource)`. No implicit Admin.                        |
| Audit                                           | All state changes, threshold changes, simulator events (FR-30)| Append-only rows in `AuditLog`. Hash-chain immutability is v2 (NFR-7).                        |
| Per-frame signing                               | Not in v1 (NFR-7)                                            | Frames trust the WebSocket's JWT; v2 may add per-frame signatures.                           |
| Multi-factor / SSO                             | Not in v1 (FR-26)                                            | Single-factor password + JWT only. SSO/MFA deferred to v2.                                    |

A production deployment must additionally: terminate TLS at a reverse proxy, rotate `JWT_SECRET` (when v2 lands), enforce network egress controls on the api process, and isolate the Postgres instance from the public network.

---

## Acknowledgements

Security researchers who report valid vulnerabilities are credited in the fix release notes unless they request anonymity. Thank you for helping keep Surakkha — and the schools it serves — safe.