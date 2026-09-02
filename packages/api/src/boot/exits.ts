/** Named exit codes the boot path may emit. `EX_CONFIG` (78) is
 *  the sysexits.h "configuration error" code, emitted when the
 *  rule cache contains a write-amplification rule (a rule that
 *  would melt the database within seconds of a real device
 *  connecting). `EXIT_FAILURE` (1) is the catch-all for any
 *  other boot failure; Docker Compose restarts on any non-zero. */
// eslint-disable-next-line no-magic-numbers
export const EX_CONFIG = 78 as const;
export const EXIT_FAILURE = 1 as const;
