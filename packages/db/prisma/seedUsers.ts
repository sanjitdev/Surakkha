/**
 * Surakkha user seed — Story 4.2.
 *
 * Upserts the six v1 demo users (1 Admin + 2 Operators + 2 Technicians +
 * 1 Viewer) into the `User` table. Idempotent: re-runs never duplicate
 * a row, and the `update: {}` no-op preserves a User that an Admin has
 * edited (e.g., displayName) via a future `/admin/users` page.
 *
 * The `id` is the JWT `sub` (UUIDv4) the api will issue for each
 * demo role. The api's lazy-upsert pattern in `resolveActorUserId`
 * (defense-in-depth) handles first-sight user creation for any
 * non-demo JWT; this seed is the canonical demo path.
 *
 * Run via:
 *   pnpm --filter @surakkha/db seed:users
 *
 * The seed deliberately uses deterministic UUIDs (not `crypto.randomUUID()`)
 * so the demo tokens issued by the api's `/auth/login` against the
 * seeded users always resolve to the same User row. **The UUIDs
 * MUST match `packages/api/src/auth/users.ts`'s `SEED_SPECS`** —
 * code review 2026-08-27 found a divergence that broke every demo
 * login except Admin; both rosters now use the canonical a001..a007
 * prefix reserved for demo users:
 *   - 1 Admin: a001 (Surakkha Admin)
 *   - 2 Operators: a002 (Operator Alpha), a006 (Operator Beta)
 *   - 2 Technicians: a003 (Technician Alpha), a007 (Technician Beta)
 *   - 1 Viewer: a004 (Surakkha Viewer)
 */
import { PrismaClient } from "@prisma/client";

/**
 * Demo user roster. The `id` field is a stable UUIDv4 — the api's
 * `/auth/login` (Story 1.4) issues JWTs with `sub: id` matching
 * one of these rows so the seed round-trips with the auth layer.
 *
 * UUIDs were generated via `uuidgen` against the seed-namespaced
 * prefix `0x4e4f4e43` ("NONC" in ASCII — a deliberately-unique
 * prefix distinct from device UUIDs which use `c0ffee`-prefixed
 * IDs). Re-generate only if the demo JWT logic changes.
 */
interface DemoUser {
  readonly id: string;
  readonly role: "Admin" | "Operator" | "Technician" | "Viewer";
  readonly displayName: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    role: "Admin",
    displayName: "Surakkha Admin",
  },
  {
    id: "00000000-0000-4000-8000-00000000a002",
    role: "Operator",
    displayName: "Operator Alpha",
  },
  {
    id: "00000000-0000-4000-8000-00000000a006",
    role: "Operator",
    displayName: "Operator Beta",
  },
  {
    id: "00000000-0000-4000-8000-00000000a003",
    role: "Technician",
    displayName: "Technician Alpha",
  },
  {
    id: "00000000-0000-4000-8000-00000000a007",
    role: "Technician",
    displayName: "Technician Beta",
  },
  {
    id: "00000000-0000-4000-8000-00000000a004",
    role: "Viewer",
    displayName: "Surakkha Viewer",
  },
];

const main = async (): Promise<void> => {
  const prisma = new PrismaClient();
  try {
    let createdCount = 0;
    let noopCount = 0;

    for (const user of DEMO_USERS) {
      // `upsert` keyed on User.id — idempotent on re-run.
      // `update: {}` is the load-bearing detail: a no-op update
      // preserves a User that an Admin has edited (e.g.,
      // displayName) via the future /admin/users page.
      // `set: { role, displayName }` only fires on first insert.
      const result = await prisma.user.upsert({
        where: { id: user.id },
        create: {
          id: user.id,
          role: user.role,
          displayName: user.displayName,
        },
        update: {},
        select: { id: true, createdAt: true },
      });
      // Heuristic: `createdAt` very close to now → first insert.
      // `update: {}` is a no-op, so `updatedAt` doesn't move.
      const createdFresh = Date.now() - result.createdAt.getTime() < 5_000;
      if (createdFresh) {
        createdCount += 1;
      } else {
        noopCount += 1;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `seedUsers: processed ${DEMO_USERS.length} demo user rows: ${createdCount} created, ${noopCount} no-op`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  // eslint-disable-next-line no-restricted-properties
  process.exit(1);
});
