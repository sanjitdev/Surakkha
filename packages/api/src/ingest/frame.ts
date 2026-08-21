/**
 * Ingest handler — placeholder for Story 2.2 (AC4).
 *
 * The actual WS handler lives here in Story 2.2; this file exists now so
 * the AC4 contract is visible at the seam before implementation lands.
 *
 * Processing order (architecture §3.2, ADR 0013). The order is
 * load-bearing — see ADR 0013 for the rationale per step:
 *
 *   1. validate
 *   2. auth check
 *   3. rate check
 *   4. seq/drop check
 *   5. persist
 *   6. rule evaluation
 *   7. alert emission
 *   8. state-machine update
 *   9. audit append
 *  10. socket broadcast
 *
 * Reordering any adjacent pair is a contract violation. Story 2.2 must
 * run `PROCESSING_ORDER` steps in exactly this order.
 *
 * Reference: docs/adr/0013-server-processing-order.md
 */
import { PROCESSING_ORDER } from "@surakkha/shared";

// Anchor the import so a future edit cannot delete it without a TS error.
// Story 2.2 replaces this with the real handler; the tuple length must
// match the comment block above.
const _PROCESSING_ORDER_LENGTH = PROCESSING_ORDER.length;
