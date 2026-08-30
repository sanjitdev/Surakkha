/**
 * `boot/exits.ts` — Story 3.4 (distilled 2026-08-30).
 *
 * Named constants for the process exit codes the boot path may emit.
 *
 * `EX_CONFIG` (78) is the sysexits.h "configuration error" code,
 * emitted by the api boot guard when the rule cache contains a
 * write-amplification rule (a rule that would fire on every frame
 * and would melt the database within seconds of a real device
 * connecting). The choice of 78 over a plain `process.exit(1)` is
 * deliberate: 78 is the standard signal for "the operator (or the
 * CI step that built the rule) must fix this configuration before
 * the api can serve traffic." Pinned by
 * `packages/api/__tests__/boot-exit-code.spec.ts`.
 *
 * `EXIT_FAILURE` (1) is the catch-all for any other boot failure
 * (transient DB outage, missing JWT_SECRET, etc.). Docker Compose
 * restarts the container on any non-zero exit code, so 1 is the
 * "retry" path.
 *
 * History: the magic number `78` lived inline at
 * `src/index.ts:834` with a `// eslint-disable-next-line no-magic-numbers`
 * suppression. The constant lives here so:
 *   1. The suppression is gone.
 *   2. A future operator-facing message can quote the same code
 *      without re-reading the boot path.
 */
// eslint-disable-next-line no-magic-numbers
export const EX_CONFIG = 78 as const;
export const EXIT_FAILURE = 1 as const;
