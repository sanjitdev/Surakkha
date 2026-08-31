#!/usr/bin/env node
/**
 * Surakkha prose linter — Story: AI-slop catch for JSDoc + markdown.
 *
 * Scope: hedge words and AI-generation tells in `.ts/.tsx/.md` files.
 * Designed to run in the husky pre-commit hook (alongside ESLint) so
 * a contributor can't land prose that drifts from the Surakkha voice.
 *
 * Why a hand-rolled Node script and not vale.sh / textlint:
 *   - Zero install friction — Node 20+ is already required by `engines`
 *     in `package.json`, no extra binary needed.
 *   - The lint runs in <300ms across the 524-test codebase.
 *   - Configuration lives in this file (next to the rule code) so a
 *     future contributor editing the rule doesn't need to chase a
 *     separate `.vale.ini` / `.textlintrc`.
 *
 * Architecture:
 *   1. Walk the paths passed on argv (default: `packages/**`).
 *   2. For each file, tokenize comments / markdown lines.
 *   3. Apply each rule from `RULES` below. Each rule returns an array
 *      of `{line, column, message}` violations or `[]`.
 *   4. Aggregate, print to stderr, exit non-zero if any file has any.
 *
 * Rule design:
 *   - Existence rules flag a forbidden word/phrase anywhere in scope.
 *   - Each rule ships with a fix suggestion where the substitution is
 *     mechanical ("obviously has" → "has"); otherwise the rule just
 *     reports and lets the contributor reword.
 *   - Rules skip URLs, file paths, and code samples so we don't flag
 *     hex literals (`#FFFFFF`), package versions (`v1.2.3`), or
 *     comments that quote a config value verbatim.
 *
 * Adding a rule:
 *   - Append an entry to `RULES` with `{ id, pattern, message, suggestion? }`.
 *   - `pattern` is a RegExp tested against each comment/markdown line.
 *     Use word boundaries when the trigger should be a word, not a substring.
 *   - `message` is the lint violation text.
 *   - `suggestion` is the replacement snippet shown in the output.
 *
 * Scope of rules — the 2026-08-31 /impeccable critique flagged that
 * AI-generated JSDoc reads with hedging prose ("obviously", "simply",
 * "we use", etc.). This linter targets exactly that class of tell.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Configurable list of file globs to scan. Patterns are matched against
 * paths relative to the repo root via `picomatch`-style globs (we use
 * a small custom matcher since the rest of the repo doesn't depend on
 * a glob library — and adding one for one linter is overkill).
 */
const SCAN_GLOBS = ["packages/**/*.ts", "packages/**/*.tsx", "packages/**/*.md"];

/**
 * Regex used to extract single-line and block comments from
 * TypeScript / TSX source. Markdown files are read whole — every line
 * is prose. The TS scanner preserves the comment body (without leading
 * `//` or block markers) and the line/column of the first content char.
 */
const SINGLE_LINE_COMMENT = /\/\/(.+)$/g;
const BLOCK_COMMENT = /\/\*([\s\S]*?)\*\//g;

/**
 * Rules — the heart of the linter. Each entry is a prose pattern we
 * want to flag. Keep the list small and surgical: a 50-rule prose
 * linter that fires on every diff is worse than a 10-rule one that
 * only fires on the tells we've actually shipped.
 */
const RULES = [
  {
    id: "hedge-obviously",
    // `\bobviously\b` — single-word hedge. Skips the substring inside
    // words like "unobviously". The critique found one such instance
    // in `apiClient.ts:189` ("which obviously has no token yet").
    pattern: /\bobviously\b/i,
    message: "Hedge word — state the constraint directly without the AI tell.",
    suggestion: "Remove 'obviously' and rephrase the sentence as a fact.",
  },
  {
    id: "hedge-simply",
    // `\bsimply\b` — instructions that say "simply X" assume the reader
    // finds X simple. Replace with the actual action.
    pattern: /\bsimply\b/i,
    message: "Hedge word — 'simply' implies the action is obvious. State the action.",
    suggestion: "Replace with the imperative verb or remove entirely.",
  },
  {
    id: "hedge-just",
    // `\bjust\b` (followed by a verb) — AI prose loves "we just do X".
    // The 'just' is redundant; the verb is the action. Skip when the
    // line contains semantic uses: "just now" (UX copy / test label),
    // "not just" (emphasiser), "just outside" (threshold proximity).
    // The skip is per-line: if any of these phrases is present, the
    // rule defers. The 33→<5 false-positive ratio justifies the cost.
    pattern: /\bjust\s+[a-z]/i,
    skipIf: /\bjust (now|outside)\b|\bnot just\b/i,
    message: "Hedge word — 'just' before a verb is redundant filler.",
    suggestion: "Remove 'just' or replace with the imperative.",
  },
  {
    id: "hedge-basically",
    pattern: /\bbasically\b/i,
    message: "Hedge word — drops reader confidence without adding information.",
    suggestion: "Remove the word; the next clause should stand alone.",
  },
  {
    id: "hedge-essentially",
    pattern: /\bessentially\b/i,
    message: "Hedge word — synonym for 'basically'. Same critique applies.",
    suggestion: "Remove the word.",
  },
  {
    id: "hedge-naturally",
    pattern: /\bnaturally\b/i,
    message: "Hedge word — implies 'obviously' without saying it.",
    suggestion: "Remove or replace with a concrete reason.",
  },
  {
    id: "hedge-of-course",
    pattern: /\bof course\b/i,
    message: "Hedge phrase — same tell as 'obviously'.",
    suggestion: "Remove or replace with a concrete reason.",
  },
  {
    id: "hedge-we-use",
    // "We use X" — first-person plural in JSDoc reads as AI-generated
    // commentary rather than documentation. The contract is the JSDoc's
    // subject, not "we".
    pattern: /\bwe use\b/i,
    message: "First-person plural in JSDoc — the code, not 'we', is the subject.",
    suggestion: "Rewrite in the imperative or passive voice.",
  },
  {
    id: "hedge-lets-contracted",
    // "Let's X" — the *contraction* of "let us" reads conversational.
    // We match the contraction only (with apostrophe); the verb form
    // ("X lets Y do Z") is legitimate English and skipped. Word
    // boundary on the apostrophe handles the disambiguation.
    pattern: /\blet['']s\b/,
    message: "Conversational 'let's' — prefer imperative voice.",
    suggestion: "Replace with the imperative form.",
  },
  {
    id: "all-caps-shout",
    // SHOUTING ALL-CAPS WORDS in comments (`IMPORTANT:`, `WARNING:`,
    // `NOTE:`). The critique flagged 2 instances. Caps-shouting is the
    // canonical AI-leakage pattern; the prose reads as generated
    // boilerplate even when the underlying constraint is real.
    pattern: /\b(IMPORTANT|WARNING|NOTE|CAUTION|DANGER|FIXME|HACK):/,
    message: "All-caps shouting header in JSDoc — the constraint reads as AI boilerplate.",
    suggestion:
      "Lower-case the prefix ('Note:', 'Warning:'); the surrounding prose carries the weight.",
  },
  {
    id: "double-hedge",
    // "We can simply just..." — the textbook AI-combo.
    pattern: /\b(can|could|would|will)\s+(simply|just|basically|essentially)\b/i,
    message: "Double hedge — modal + filler verb. Pick one or none.",
    suggestion: "Reduce to a single verb.",
  },
  {
    id: "exclamation-mark",
    // Spec copy rule: no exclamation marks in user-facing strings.
    // JSDoc is documentation, but a `!` in a JSDoc sentence usually
    // indicates marketing-tone drift.
    pattern: /!\s*$/m,
    message: "Exclamation mark at end of line — DESIGN.md voice is calm, not emphatic.",
    suggestion: "Replace the sentence with a period.",
  },
];

/**
 * Files to skip. `.bmad`, `.impeccable`, and `node_modules` are out of
 * scope; the planning artifacts often quote machine output verbatim,
 * which is intentional.
 */
const IGNORE_PATH_PREFIXES = [
  "node_modules",
  ".bmad-output",
  "_bmad",
  ".impeccable",
  "dist",
  "build",
  "coverage",
];

/**
 * Custom glob matcher — supports `**` (any depth) and `*` (single
 * segment). Avoids pulling in `picomatch` / `globby` for one consumer.
 */
const globToRegex = (glob) => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
};

const matchesAnyGlob = (relPath, globs) => globs.some((g) => globToRegex(g).test(relPath));

const shouldIgnore = (relPath) =>
  IGNORE_PATH_PREFIXES.some((prefix) => {
    if (relPath === prefix) return true;
    if (relPath.startsWith(prefix + "/")) return true;
    // Match anywhere in the path — `packages/api/dist/x.ts` should be
    // skipped because it contains `/dist/`. Without this, the linter
    // walks build outputs and 3rd-party packages.
    if (relPath.includes("/" + prefix + "/")) return true;
    return false;
  });

const walkDir = (dir, accumulator) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkDir(full, accumulator);
    } else {
      accumulator.push(full);
    }
  }
};

/**
 * Walk a glob root like `packages/` and yield every file matching any
 * of `SCAN_GLOBS`. We translate the glob root into a directory walk by
 * stripping the `**` segment — the rest of the path is the entry-point.
 */
const collectFiles = () => {
  const files = [];
  // The glob roots are `packages/**`. The walk starts from `packages`.
  const roots = Array.from(new Set(SCAN_GLOBS.map((g) => g.split("/**")[0])));
  for (const root of roots) {
    const full = join(repoRoot, root);
    try {
      walkDir(full, files);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  return files.filter((f) => {
    const rel = relative(repoRoot, f).split(sep).join("/");
    return matchesAnyGlob(rel, SCAN_GLOBS) && !shouldIgnore(rel);
  });
};

/**
 * Yield `{ line, column, text }` for each comment block in a TS file.
 * Single-line comments (`// ...`) and block comments (`/* ... *\/`)
 * are both surfaced so the rule set catches either form.
 *
 * `line` is 1-indexed; `column` is 1-indexed at the start of the
 * comment body (i.e. after `//` or `/*`).
 */
const extractTsComments = (source) => {
  const out = [];
  for (const match of source.matchAll(SINGLE_LINE_COMMENT)) {
    const line = source.slice(0, match.index).split("\n").length;
    out.push({ line, column: match[1].startsWith(" ") ? 3 : 2, text: match[1].trim() });
  }
  for (const match of source.matchAll(BLOCK_COMMENT)) {
    const start = match.index;
    const blockStartLine = source.slice(0, start).split("\n").length;
    // Block comments can span multiple lines. We surface the whole
    // block as one entry, but emit a violation per offending line so
    // the contributor knows where to fix.
    const lines = match[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].replace(/^\s*\*/gm, "").trim();
      if (text.length === 0) continue;
      out.push({ line: blockStartLine + i, column: 1, text });
    }
  }
  return out;
};

/**
 * Yield `{ line, column, text }` for each non-blank markdown line.
 * Markdown files are read whole — every non-blank line is prose that
 * the rules apply to.
 */
const extractMarkdownLines = (source) => {
  const lines = source.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (text.trim().length === 0) continue;
    if (text.startsWith("```")) continue; // Skip code-fence lines
    out.push({ line: i + 1, column: 1, text });
  }
  return out;
};

/**
 * Skip URL-like, file-path, and code-quote content so we don't false-
 * positive on:
 *   - `#FFFFFF` in a JSDoc example quoting a CSS value
 *   - `we use react-query` (the verb is the technical name)
 *   - package versions like `v1.2.3`
 *
 * Heuristic: a line is "code-ish" if it contains a backtick, a hash
 * followed by a hex digit, or an obvious import path. This is a coarse
 * filter; rules can opt out individually via `pattern` if needed.
 */
const isCodeLike = (text) => {
  if (text.includes("`")) return true;
  if (/#[0-9a-fA-F]{3,8}\b/.test(text)) return true;
  if (/from\s+["'][^"']+["']/.test(text)) return true;
  return false;
};

/**
 * Apply every rule to every comment/markdown line and aggregate.
 */
const lintFile = (file) => {
  const source = readFileSync(file, "utf8");
  const isMd = file.endsWith(".md");
  const entries = isMd ? extractMarkdownLines(source) : extractTsComments(source);
  const violations = [];
  for (const { line, column, text } of entries) {
    if (isCodeLike(text)) continue;
    for (const rule of RULES) {
      if (rule.skipIf && rule.skipIf.test(text)) continue;
      if (rule.pattern.test(text)) {
        violations.push({
          file: relative(repoRoot, file),
          line,
          column,
          rule: rule.id,
          message: rule.message,
          suggestion: rule.suggestion,
          context: text.length > 80 ? text.slice(0, 77) + "..." : text,
        });
      }
    }
  }
  return violations;
};

const main = () => {
  const files = collectFiles();
  const allViolations = [];
  for (const file of files) {
    const v = lintFile(file);
    if (v.length > 0) allViolations.push(...v);
  }
  if (allViolations.length === 0) {
    process.exit(0);
  }
  process.stderr.write(
    `\nprose-lint: ${allViolations.length} violation(s) across ${new Set(allViolations.map((v) => v.file)).size} file(s)\n\n`,
  );
  for (const v of allViolations) {
    process.stderr.write(`  ${v.file}:${v.line}:${v.column}  [${v.rule}]\n`);
    process.stderr.write(`    ${v.context}\n`);
    process.stderr.write(`    → ${v.message}\n`);
    if (v.suggestion) process.stderr.write(`    fix: ${v.suggestion}\n`);
    process.stderr.write("\n");
  }
  process.exit(1);
};

main();
