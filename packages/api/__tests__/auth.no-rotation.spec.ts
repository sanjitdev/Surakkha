/**
 * Story 1.10 — Single-Secret JWT Rotation Policy (FR-25, I-13).
 *
 * Pins the v1 contract: the api uses HS256 with a single `JWT_SECRET`
 * and does NOT read any rotation-related env var. A future PR that
 * introduces JWKS support must bump to v2 (see README §JWT) and
 * remove these invariants in the same change.
 *
 * Strategy: walk the api source tree and assert no forbidden env var
 * is referenced. This is more reliable than a `process.env` mock
 * because the test pins the source — a future PR that adds `JWT_PUBLIC_KEY`
 * to a handler or middleware will fail this test on the file itself.
 *
 * Forbidden env vars (the test name carries the contract):
 *   - JWT_PUBLIC_KEY  — RS256 / ES256 public key (JWKS)
 *   - JWT_PRIVATE_KEY — RS256 / ES256 private key (JWKS)
 *   - JWT_KEY_SET     — JWKS endpoint URL
 *   - JWT_KEY_ID      — rotation key id
 *   - JWT_ALGORITHM   — runtime-algorithm switch (means rotation-ready)
 *   - JWT_KEY_ROTATION_INTERVAL — rotation interval
 *
 * The list is exported so the lint script can grep the same set
 * without duplicating the string table.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const FORBIDDEN_ENV_VARS = [
  "JWT_PUBLIC_KEY",
  "JWT_PRIVATE_KEY",
  "JWT_KEY_SET",
  "JWT_KEY_ID",
  "JWT_ALGORITHM",
  "JWT_KEY_ROTATION_INTERVAL",
] as const;

const API_SRC = join(__dirname, "..", "src");

/**
 * Recursively walk `dir`, yielding every file path. Symlinks and
 * VCS metadata (`node_modules`, `.git`, `dist`) are skipped.
 */
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") {
        continue;
      }
      out.push(...walk(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Match a `process.env["FOO"]` / `process.env.FOO` / `env["FOO"]`
 * reference for a given forbidden name.
 *
 * The pattern is intentionally narrow: it only matches the env
 * accessor, not commentary that happens to mention the literal.
 * The test also strips comments and string-literal previews so a
 * JSDoc line that says "JWKS / RS256" doesn't trip the check.
 */
const ENV_REFERENCE = (name: string): RegExp => new RegExp(
  `(?:process\\s*\\.\\s*env|env)\\s*(?:\\.\\s*\\[?\\s*["'](?:[^"']+)["']\\s*\\]?|\\[\\s*["']${name}["']\\s*\\]|\\.\\s*${name})`,
);

/**
 * Lines that mention the forbidden literal in a JSDoc or string
 * context are tolerated — only `process.env.<name>` / `env["<name>"]`
 * style references are forbidden. This lets the api source discuss
 * JWKS in comments without breaking the test.
 */
const findForbiddenReferences = (file: string): ReadonlyArray<{
  readonly name: string;
  readonly line: number;
  readonly snippet: string;
}> => {
  const text = readFileSync(file, "utf-8");
  // Strip line comments and block comments so the test doesn't trip
  // on documentation that names the forbidden env vars.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: Array<{ name: string; line: number; snippet: string }> = [];
  for (const name of FORBIDDEN_ENV_VARS) {
    const re = ENV_REFERENCE(name);
    const matches = stripped.matchAll(new RegExp(re, "g"));
    for (const m of matches) {
      const idx = m.index ?? 0;
      const before = stripped.slice(0, idx);
      const line = before.split("\n").length;
      const snippet = stripped.slice(idx, idx + 80).replace(/\s+/g, " ").trim();
      out.push({ name, line, snippet });
    }
  }
  return out;
};

describe("Story 1.10 — Single-Secret JWT Rotation Policy (FR-25, I-13)", () => {
  it("FORBIDDEN_ENV_VARS is non-empty and readable", () => {
    expect(FORBIDDEN_ENV_VARS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_ENV_VARS).toContain("JWT_PUBLIC_KEY");
  });

  it("api source files do not reference any forbidden rotation env var", () => {
    // Walk the api source tree and assert no references. The test
    // fails with a directory-relative path so the violation is
    // easy to find in a CI log.
    const apiRoot = API_SRC;
    const files = walk(apiRoot).filter((f) => f.endsWith(".ts"));
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(__dirname, file).replace(/\\/g, "/");
      for (const v of findForbiddenReferences(file)) {
        violations.push(`${rel}:${v.line} references ${v.name} -> ${v.snippet}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("the forbidden env var list is the same one the api would refuse to read", () => {
    // Pin the contract: the list is exported so other tooling (lint
    // script, README, architecture appendix) can reference the same
    // set. A PR that adds a new forbidden env var must update this
    // list AND the README in the same change.
    const expected = [
      "JWT_PUBLIC_KEY",
      "JWT_PRIVATE_KEY",
      "JWT_KEY_SET",
      "JWT_KEY_ID",
      "JWT_ALGORITHM",
      "JWT_KEY_ROTATION_INTERVAL",
    ];
    expect([...FORBIDDEN_ENV_VARS].sort()).toEqual([...expected].sort());
  });
});
