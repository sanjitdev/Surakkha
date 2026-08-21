# 0004 — HS256 with a single JWT_SECRET

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** I-13, §3.4, §7
**Supersedes:** (none)
**Superseded by:** (none)

## Context

The Surakkha API signs and verifies short-lived JWTs for two audiences:

- `aud=simulator` — the in-process simulator, with `exp - iat = 1h`.
- `aud=device` — future hardware, with `exp - iat = 24h`.

The signing algorithm choice is load-bearing: it determines how secrets
are provisioned, how a leak is handled, and how easy it is for a third
party (firmware team, an external integrator) to verify tokens.

Forces:

- The verifier and signer are **the same process** in v1 (ADR 0002).
  No cross-org verification.
- The deployment runs in **one region, one container**. There is no
  fleet of verifiers that all need the public key.
- The threat model (SECURITY.md) treats a leaked `JWT_SECRET` as a
  catastrophic event regardless of algorithm choice, because the
  secret holder can mint any device identity.

## Decision

We use **HS256 with a single symmetric `JWT_SECRET`** read from
`process.env`. The secret is generated at install time and stored only
in `.env` (gitignored). Tokens expire in 1h for simulator and 24h for
device audiences.

Three corollaries:

1. **No public-key crypto in v1.** RS256 / ES256 are not used. A
   second secret rotation key is not held in escrow.
2. **No JWKS endpoint.** All verifiers use the same single secret.
3. **Token refresh is in-process.** The simulator mints its own token
   at boot. There is no admin "rotate device token" endpoint in v1.

## Consequences

**Positive**

- One env var, one rotation procedure. "Rotate the secret, restart
  everything" is a complete incident response.
- HS256 is fast, well-supported, and the default in every JWT library.
  No native bindings, no KMS dependency.
- Simpler deployment story: no key-management service, no HSM, no
  `kid` header plumbing.

**Negative**

- A leaked `JWT_SECRET` lets an attacker mint valid tokens for any
  device. Detection requires monitoring for unexpected device
  connections, not signature failures.
- Multi-region deployments in v2 will need a different algorithm.
  HS256 with a shared secret across regions is a worse posture than
  RS256 with a per-region public key.

**Neutral**

- We are not placing a bet on a particular identity provider (Okta,
  Auth0, Keycloak). Federation is a v2 problem.

## Reversal

The HS256 single-secret decision reverses when any of the following
holds:

- **A second service must verify Surakkha tokens** (e.g. an external
  data pipeline, an OEM partner). HS256 forces them to hold the
  signing key, which is bad practice. We move to RS256 with a public
  JWKS endpoint.
- **Compliance requires key rotation without downtime.** HS256 with
  one secret means rotation requires a coordinated restart. RS256
  with overlapping keys in the JWKS allows graceful rotation.
- **A leaked `JWT_SECRET` is suspected or detected.** Immediate
  rotation, plus an algorithm change, because the secret is now
  considered compromised even after rotation.

Until then, HS256. The threat model accepts that the secret holder
is the only entity that can verify tokens; the threat model rejects
federation for v1.