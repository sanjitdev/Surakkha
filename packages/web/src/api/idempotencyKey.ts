/**
 * `idempotencyKey.ts` — closes web-side P1 #2 (api critique).
 *
 * Generates a fresh RFC 4122 v4 UUID per call. Used by the 5
 * incident transition mutation hooks
 * (`useAcknowledgeMutation` / `useAssignMutation` /
 * `useSubmitResultMutation` / `useReopenMutation`, future
 * `useResolveMutation`) to attach `Idempotency-Key: <UUIDv4>`
 * to every transition POST.
 *
 * Closes the persona-blocking "Rahim the Operator" double-tap
 * surface: when Rahim taps "Acknowledge" twice on a flaky 3G
 * uplink, the second request now carries the SAME UUID as the
 * first (because the click handler captures the key in a
 * `useRef` before calling `mutate()`), and the api's
 * `Idempotency-Key` middleware (`packages/api/src/middleware/idempotency.ts`)
 * replays the cached first response byte-for-byte instead of
 * running a second `OPEN → ACKNOWLEDGED` transition.
 *
 * The key is captured per-CLICK (not per-app-boot) so two
 * unrelated clicks still produce distinct keys — the dedup
 * window only deduplicates the same intent within the api's
 * `IDEMPOTENCY_TTL_MS` (5 minutes).
 *
 * `crypto.randomUUID()` is provided by the DOM lib in TS 5.5+
 * (`packages/web/tsconfig.json` line 8: `"lib": ["ES2022", "DOM", "DOM.Iterable"]`)
 * and by all evergreen browsers since 2022 — no polyfill is
 * shipped. Server-side rendering is not a concern (the api side
 * is the server; the web is the browser; this file is web-only).
 */
export const newIdempotencyKey = (): string => crypto.randomUUID();
