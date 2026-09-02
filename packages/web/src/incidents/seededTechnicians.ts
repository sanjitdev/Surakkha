/**
 * Hardcoded Technician user ids sourced from the Prisma seed.
 * Consumed by the detail page's Assign `<select>`. Pinned as
 * constants so the RBAC specs reference the same UUIDs as
 * `Technician-1` / `Technician-2`.
 */
export const SEEDED_TECHNICIAN_IDS: readonly string[] = [
  "00000000-0000-4000-8000-00000000a003", // TECH_ID (operator1's paired tech)
  "00000000-0000-4000-8000-00000000a007", // OTHER_TECH_ID
] as const;
