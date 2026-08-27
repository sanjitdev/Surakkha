/**
 * Seeded user store — Surakkha api (Story 1.4 + Story 4.2).
 *
 * Six canonical demo users matching the Prisma `seedUsers.ts` (1 Admin
 * + 2 Operators + 2 Technicians + 1 Viewer). The hashes are produced
 * at module-load time so the api can be tested without touching the
 * database. Persistence lands when the Prisma `User` model is the
 * source of truth at runtime (see Story 4.2's lazy-upsert in
 * `packages/api/src/index.ts`); the surface (`findUserByEmail`,
 * `findUserById`) stays stable so the swap is mechanical.
 *
 * Demo credentials (also documented in BRD §13):
 *   admin@surakkha.test    / demo-admin
 *   operator@surakkha.test / demo-operator
 *   operator2@surakkha.test / demo-operator2
 *   technician@surakkha.test / demo-technician
 *   technician2@surakkha.test / demo-technician2
 *   viewer@surakkha.test   / demo-viewer
 *
 * Cost factor 12 (Story 1.4 AC: "bcrypt cost factor 12").
 */
import { type Role } from "@surakkha/shared/rbac";
import bcrypt from "bcrypt";

const BCRYPT_COST = 12;

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly passwordHash: string;
}

interface SeedSpec {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly password: string;
}

const SEED_SPECS: readonly SeedSpec[] = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    email: "admin@surakkha.test",
    displayName: "Demo Admin",
    role: "Admin",
    password: "demo-admin",
  },
  {
    id: "00000000-0000-4000-8000-00000000a002",
    email: "operator@surakkha.test",
    displayName: "Demo Operator",
    role: "Operator",
    password: "demo-operator",
  },
  {
    id: "00000000-0000-4000-8000-00000000a006",
    email: "operator2@surakkha.test",
    displayName: "Demo Operator 2",
    role: "Operator",
    password: "demo-operator2",
  },
  {
    id: "00000000-0000-4000-8000-00000000a003",
    email: "technician@surakkha.test",
    displayName: "Demo Technician",
    role: "Technician",
    password: "demo-technician",
  },
  {
    id: "00000000-0000-4000-8000-00000000a007",
    email: "technician2@surakkha.test",
    displayName: "Demo Technician 2",
    role: "Technician",
    password: "demo-technician2",
  },
  {
    id: "00000000-0000-4000-8000-00000000a004",
    email: "viewer@surakkha.test",
    displayName: "Demo Viewer",
    role: "Viewer",
    password: "demo-viewer",
  },
];

const USERS: readonly UserRecord[] = SEED_SPECS.map((spec) => ({
  id: spec.id,
  email: spec.email,
  displayName: spec.displayName,
  role: spec.role,
  // bcrypt.hashSync at boot is fine for 4 users; for thousands of users
  // the hash would land at seed-time (Story 3.x) and the store would
  // hydrate from the database instead.
  passwordHash: bcrypt.hashSync(spec.password, BCRYPT_COST),
}));

export const findUserByEmail = (email: string): UserRecord | null => {
  const normalized = email.trim().toLowerCase();
  return USERS.find((user) => user.email === normalized) ?? null;
};

/**
 * Look up a user by their stable UUID. Used by Story 1.5's
 * authenticate middleware to translate the JWT `sub` into a `Role`.
 * Trivially stable on the seeded store; the Prisma-backed
 * implementation lands with Epic 3.
 */
export const findUserById = (id: string): UserRecord | null =>
  USERS.find((user) => user.id === id) ?? null;

export const verifyPassword = async (user: UserRecord, password: string): Promise<boolean> =>
  bcrypt.compare(password, user.passwordHash);
