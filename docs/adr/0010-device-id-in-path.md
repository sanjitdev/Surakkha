# 0010 — Device-id encoded in WebSocket path

**Status:** Accepted
**Date:** 2026-08-20
**Deciders:** Engineering team
**Related architecture IDs:** §3.3
**Supersedes:** (none)
**Superseded by:** (none)

## Context

Architecture §3.3 specifies the WebSocket transport as
`ws://<host>/ingest/{device_id}`. The `device_id` appears **both** in
the path and in the JWT `sub` claim (ADR 0004, §3.4). This is
redundant — why encode it twice?

Forces:

- The api must reject frames sent to the wrong device's WebSocket
  (a misrouted or replayed connection).
- The path is the first thing an operator sees when triaging a
  device. `wss://api.surakkha.bd/ingest/9b1c…` is human-readable in
  logs; `wss://api.surakkha.bd/ingest` is not.
- Reverse proxies (Caddy, Nginx) often key routing on path segments.
  Encoding `device_id` in the path lets the proxy apply per-device
  rate limits at the edge if we ever need that.

## Decision

We **require** the path to match the JWT `sub` claim. Mismatch is a
hard `403 device_id_mismatch` and the connection is closed (§3.2
processing step 4). The path is `device_id` exactly — no human label,
no school code, no serial number.

Three corollaries:

1. **No path translation.** The api does not rewrite the path. What
   the device sent is what gets logged.
2. **Path is the canonical device identifier at the transport layer.**
   The JWT `sub` claim is for authentication; the path is for routing
   and logging.
3. **Logs are de-identified.** We log the path's `device_id`, not the
   JWT `sub`, in operator-facing logs. They are the same value, but
   the log entry points at the path because that is what the operator
   sees.

## Consequences

**Positive**

- A misrouted connection (a device connecting to another device's
  WebSocket) is rejected at the transport layer, before any rule
  evaluation. This is a defence against accidental or malicious
  cross-talk.
- Logs are immediately useful. An operator copying a WebSocket URL
  from a device's diagnostic output into a log search will find the
  matching server-side entry.
- Per-device rate limits at the reverse proxy become possible later
  without changing the wire contract.

**Negative**

- The `device_id` is in the URL path, which may end up in proxy
  access logs. We mitigate by logging only a hash of the `device_id`
  in the proxy access log; the api's own logs retain the full UUID.
- **Path length matters.** UUIDv4 is 36 characters; the path becomes
  `/ingest/9b1c…` (~46 chars). Negligible.
- **A device's `device_id` rotation** (rare, but possible during
  firmware re-provisioning) requires a coordinated path-and-JWT
  update.

**Neutral**

- The redundancy with the JWT `sub` claim is deliberate. Two layers
  of evidence for "which device is on this connection".

## Reversal

The device-id-in-path decision reverses when:

- **A device class connects over multiple transports** (e.g. one
  device opens WS, MQTT, and HTTP simultaneously). A single path
  segment cannot name all three. We add a `transport:<n>` segment
  after `device_id`.
- **Per-device routing at the proxy is no longer needed**, and the
  path redundancy becomes pure overhead. We collapse to
  `/ingest` and rely on JWT `sub` alone. (Low likelihood; the
  human-readability benefit remains.)
- **Compliance mandates TLS-only device identifiers** that cannot
  appear in URLs (e.g. PII concerns). The path becomes opaque; the
  api extracts the device_id from the JWT only.

Until then, `device_id` in path, matched against JWT `sub`, mismatch
is fatal. The path is the human contract; the JWT is the
cryptographic contract; the two agree.
