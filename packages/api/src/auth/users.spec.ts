/**
 * Story 1.4 — seeded user store.
 *
 * Covers:
 *   - All four canonical roles are seeded (Admin / Operator / Technician / Viewer)
 *   - findUserByEmail is case-insensitive + trims whitespace
 *   - bcrypt hash is stored, plaintext never appears
 *   - verifyPassword returns true for the demo password, false for any other
 */
import { describe, expect, it } from "vitest";

import { findUserByEmail, verifyPassword } from "./users";

describe("Story 1.4 — seeded user store", () => {
  it("seeds all four roles", () => {
    expect(findUserByEmail("admin@surakkha.test")?.role).toBe("Admin");
    expect(findUserByEmail("operator@surakkha.test")?.role).toBe("Operator");
    expect(findUserByEmail("technician@surakkha.test")?.role).toBe("Technician");
    expect(findUserByEmail("viewer@surakkha.test")?.role).toBe("Viewer");
  });

  it("matches email case-insensitively and trims whitespace", () => {
    expect(findUserByEmail("ADMIN@surakkha.test")?.role).toBe("Admin");
    expect(findUserByEmail("  admin@surakkha.test  ")?.role).toBe("Admin");
  });

  it("returns null for unknown emails", () => {
    expect(findUserByEmail("nobody@surakkha.test")).toBeNull();
  });

  it("stores bcrypt hashes; plaintext never appears in the record", () => {
    const user = findUserByEmail("admin@surakkha.test");
    expect(user).not.toBeNull();
    // bcrypt hashes start with $2 — never the plaintext password.
    expect(user?.passwordHash.startsWith("$2")).toBe(true);
    expect(user?.passwordHash).not.toContain("demo-admin");
  });
});

describe("Story 1.4 — password verification", () => {
  it("accepts the demo password for the seeded user", async () => {
    const user = findUserByEmail("admin@surakkha.test");
    expect(user).not.toBeNull();
    const ok = await verifyPassword(user!, "demo-admin");
    expect(ok).toBe(true);
  });

  it("rejects any other password", async () => {
    const user = findUserByEmail("viewer@surakkha.test");
    expect(user).not.toBeNull();
    const ok = await verifyPassword(user!, "wrong");
    expect(ok).toBe(false);
  });
});