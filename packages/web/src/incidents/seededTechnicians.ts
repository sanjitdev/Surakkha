/**
 * `seededTechnicians.ts` — Story 4.6.
 *
 * Hardcoded list of Technician user ids sourced from the Prisma seed
 * (`packages/db/prisma/seedUsers.ts` — Story 4.2 AC10). Used by the
 * inline `<select>` on the detail page's Assign form.
 *
 * v1 simplification: no `/api/users?role=Technician` endpoint exists,
 * so the web client sources the two Technician ids directly from the
 * seed. The list is small (2 Technicians), so the `<select>` is the
 * minimum-viable UI; a fuzzy-search `<TechnicianPicker />` backed by a
 * dedicated user-management endpoint is deferred to the post-Epic-4
 * sweep that adds the user-management surface.
 *
 * Why UUID strings (not the `User` shared type): the consumers of this
 * list (`<IncidentDetailActions />` + `useAssignMutation`) only need
 * string ids to thread through the assign body. Importing the full
 * `User` type would force a backfill against a list endpoint that does
 * not exist yet. YAGNI.
 *
 * The constants are pinned here (not derived at runtime) so tests can
 * import them directly and assert that the `<option>` elements match.
 */
export const SEEDED_TECHNICIAN_IDS: readonly string[] = [
  "00000000-0000-4000-8000-00000000a003", // TECH_ID (operator1's paired tech)
  "00000000-0000-4000-8000-00000000a007", // OTHER_TECH_ID
] as const;
