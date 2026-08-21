# 0005 — Plain ws:// for v1 telemetry

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** I-14, §3.3
**Supersedes:** (none)
**Superseded by:** (none)

## Context

The telemetry transport sits between devices (or the simulator) and the
api. Architecture §3.3 mandates WebSocket at `ws://<host>/ingest/{device_id}`.
The choice between `ws://` and `wss://` (and where TLS terminates) is
load-bearing because it determines the threat model the device firmware
team must build against, and where the operational burden of certificate
management falls.

Forces:

- v1 deployments are **single-school-cluster** instances. A reverse
  proxy (Caddy, Nginx, Traefik) terminates TLS at the edge; the api
  process listens on plain HTTP/WS inside the container network.
- **No per-frame signing** is in the wire contract (§3.6).
- The threat model (SECURITY.md) treats physical access to the api's
  internal network as out-of-scope for v1.

## Decision

Telemetry transport in v1 is **`ws://`** from the device to the api
container's port. **TLS terminates at the edge reverse proxy** (Caddy
in the default `docker-compose.yml`). Devices see `wss://` on the
public side; the api sees plain `ws://` inside the container.

Three corollaries:

1. **No per-frame cryptographic signing.** Authentication is the JWT
   in the WebSocket handshake. Frame integrity relies on TLS plus the
   reverse proxy's network.
2. **The api listens on plain HTTP/WS.** No TLS library is loaded in
   the Node process.
3. **No mTLS.** Devices do not present certificates; they present a
   short-lived JWT.

## Consequences

**Positive**

- The Node process has zero TLS code. Smaller attack surface, fewer
  CVEs to patch, simpler local development.
- Certificate management is one concern (the edge proxy), not per-pod.
- `wss://` is invisible to the api code. The transport upgrade is a
  pure infrastructure concern.

**Negative**

- **A compromised reverse proxy** (or its certificate store) can read
  and forge frames. The api cannot detect this. This is accepted.
- **A future device that connects over the public internet without
  going through the proxy** will be talking plain WS. This is rejected
  by deployment policy (no public port for `ingest/`).
- **No replay protection** at the application layer. Relies on the
  reverse proxy's connection limits plus the JWT's `exp`.

**Neutral**

- The decision is about the api's interface, not the device's.
  Devices always speak `wss://`. The wire contract is silent on the
  transport layer; only the `device_id` path and JWT handshake are
  pinned.

## Reversal

The plain-ws decision reverses when any of the following holds:

- **Compliance requires end-to-end TLS** to the api process (e.g.
  regulations that prohibit decrypting telemetry at a proxy). Then we
  load TLS in Node and pin a server certificate.
- **A device must authenticate against the api's public endpoint
  directly**, with no proxy in the path (e.g. a roaming device). Then
  we move to `wss://` end-to-end.
- **A future requirement needs per-frame non-repudiation** (e.g.
  regulatory audit of "exactly which device sent which reading"). Then
  we add per-frame signing to the wire contract; that is a contract
  bump (ADR 0001).

Until then, plain `ws://` inside the container. The threat model
explicitly trusts the proxy. We do not pretend otherwise.