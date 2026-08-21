#!/usr/bin/env node
/**
 * lint-rbac-matrix.mjs — Story 1.1 CI lint.
 *
 * Fails CI when handler code under `packages/api/src/**` references an
 * `Action` string literal that is not in `RBAC_MATRIX` (the canonical
 * authority source in `packages/shared/src/rbac.ts`).
 *
 * The check is intentionally simple and reads as English:
 *
 *   1. Parse the canonical Action enum out of the RBAC matrix file.
 *   2. Walk every TypeScript file under `packages/api/src/`.
 *   3. For each line that contains `action:` followed by a string literal
 *      (the shape the api middleware and Story 1.5's authorize handler use),
 *      assert the literal is in the allow-list.
 *
 * Unknown actions become a non-zero exit code so `pnpm lint:rbac` (and the
 * root `pnpm lint`) fail. The script also surfaces "orphan" actions — those
 * present in the matrix but never referenced — as informational so a reviewer
 * can prune them deliberately.
 *
 * Usage:
 *   node scripts/lint-rbac-matrix.mjs
 *   pnpm lint:rbac
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const rbacFile = join(repoRoot, "packages", "shared", "src", "rbac.ts");
const apiSrc = join(repoRoot, "packages", "api", "src");

const failures = [];
const referenced = new Set();

/** Step 1 — extract the Action enum from rbac.ts. */
const rbacSource = readFileSync(rbacFile, "utf8");
const actionEnumMatch = rbacSource.match(
  /ActionSchema\s*=\s*z\.enum\(\[\s*([\s\S]*?)\s*\]\)/,
);
if (!actionEnumMatch) {
  console.error(
    `[lint-rbac] could not locate ActionSchema in ${relative(repoRoot, rbacFile)}`,
  );
  process.exit(2);
}
const knownActions = new Set(
  Array.from(
    actionEnumMatch[1].matchAll(/^\s*"([a-z_]+)"\s*,?\s*$/gm),
    (m) => m[1],
  ),
);

/** Step 2 — walk every .ts file under packages/api/src. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

if (!existsSync(apiSrc)) {
  // api src may not exist yet (Story 1.5+); treat absence as a pass with a
  // note, so the lint does not block early implementation steps.
  console.log(
    `[lint-rbac] no api src at ${relative(repoRoot, apiSrc)} yet; skipping. Known actions: ${[...knownActions].sort().join(", ")}`,
  );
  process.exit(0);
}

const handlerFiles = walk(apiSrc);

/**
 * Step 3 — every line of the form:
 *   action: "acknowledge"
 *   action: 'assign'
 *   { subject: "Admin", action: "read", ... }
 * is captured. Anything else (e.g. `action` used as a variable name) is
 * ignored by the trailing colon + quoted literal pattern.
 */
const ACTION_RE = /\baction\s*:\s*["']([a-z_]+)["']/g;

for (const file of handlerFiles) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    let match = ACTION_RE.exec(line);
    while (match !== null) {
      const action = match[1];
      referenced.add(action);
      if (!knownActions.has(action)) {
        failures.push({
          file: relative(repoRoot, file),
          line: idx + 1,
          action,
          snippet: line.trim(),
        });
      }
      match = ACTION_RE.exec(line);
    }
    // reset lastIndex because the regex is stateful across exec calls
    ACTION_RE.lastIndex = 0;
  }
}

const orphanActions = [...knownActions]
  .filter((a) => !referenced.has(a))
  .sort();

if (failures.length > 0) {
  console.error("[lint-rbac] FAIL — handler code references actions not in RBAC_MATRIX:");
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  action="${f.action}"  ${f.snippet}`);
  }
  console.error(
    `\nAdd the action to packages/shared/src/rbac.ts (and to docs/architecture-appendix-rbac.md), or remove the stray literal.`,
  );
  process.exit(1);
}

console.log(
  `[lint-rbac] ok — ${handlerFiles.length} handler file(s) checked, ${referenced.size}/${knownActions.size} actions referenced.`,
);
if (orphanActions.length > 0) {
  console.log(
    `[lint-rbac] note — actions in matrix not yet referenced by api handlers: ${orphanActions.join(", ")}`,
  );
}

function existsSync(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
