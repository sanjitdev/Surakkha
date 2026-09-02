/**
 * Seeded user store — Surakkha api.
 *
 * Six canonical demo users (1 Admin + 2 Operators + 2 Technicians +
 * 1 Viewer). Passwords are hashed at module-load time so the api can
 * be tested without touching the database.
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
  passwordHash: bcrypt.hashSync(spec.password, BCRYPT_COST),
}));

export const findUserByEmail = (email: string): UserRecord | null => {
  const normalized = email.trim().toLowerCase();
  return USERS.find((user) => user.email === normalized) ?? null;
};

export const findUserById = (id: string): UserRecord | null =>
  USERS.find((user) => user.id === id) ?? null;

export const verifyPassword = async (user: UserRecord, password: string): Promise<boolean> =>
  bcrypt.compare(password, user.passwordHash);
