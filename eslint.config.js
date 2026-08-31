// Surakkha — root ESLint flat config (ESLint 9.x).
//
// Tooling stack (kept aligned with CONTRIBUTING.md and architecture §2):
//   - ESLint 9.x flat config
//   - TypeScript via @typescript-eslint
//   - React + hooks + a11y for packages/web
//   - Node rules via eslint-plugin-n for packages/api and packages/simulator
//   - Import boundary enforcement: prevents one epic from importing types
//     from another epic's directory (see CONTRIBUTING.md cross-cutting rule).
//   - Prettier is wired LAST so it disables conflicting stylistic rules.
//
// To run:
//   pnpm lint          # lint everything
//   pnpm lint:fix      # auto-fix what can be fixed
//
// When packages are added later, append a block under `packages/<name>/**`
// with the matching plugin profile. Until then, this config is a no-op
// because ESLint walks the configured globs and finds no files.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import nodePlugin from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import prettier from "eslint-config-prettier";

// ---------------------------------------------------------------------------
// Shared defaults.
// ---------------------------------------------------------------------------

/** Base rules applied to every TS/TSX file in the workspace. */
const baseTsRules = {
  // Quality bar — keep the bar high but pragmatic.
  "no-console": ["warn", { allow: ["warn", "error"] }],
  "no-debugger": "error",
  "no-alert": "warn",
  "no-var": "error",
  "prefer-const": "error",
  "prefer-arrow-callback": "error",
  "object-shorthand": ["error", "always"],
  "no-unused-vars": "off", // delegated to TS plugin below
  "no-undef": "off", // TS handles this
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-implicit-coercion": ["error", { boolean: false, number: true, string: true }],
  "no-throw-literal": "error",
  "no-return-await": "off", // TS plugin handles this
  "no-else-return": ["error", { allowElseIf: false }],
  "no-lonely-if": "error",
  "no-useless-rename": "error",
  "no-useless-return": "error",
  "no-multi-spaces": ["error", { ignoreEOLComments: true }],
  "no-trailing-spaces": "error",
  "comma-dangle": ["error", "always-multiline"],
  semi: ["error", "always"],
  quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: false }],
  curly: ["error", "multi-line"],
  "arrow-body-style": ["error", "as-needed", { requireReturnForObjectLiteral: false }],
  "no-param-reassign": ["error", { props: true }],

  // --- Size rules (AGENTS.md §1.1) ----------------------------------------
  "max-lines": ["warn", { max: 500, skipComments: true, skipBlankLines: true }],
  "max-lines-per-function": ["warn", { max: 200, skipComments: true, skipBlankLines: true }],
  "max-params": ["warn", { max: 3 }],
  "max-classes-per-file": ["error", { max: 1 }],
  complexity: ["warn", { max: 10 }],
  "max-depth": ["warn", { max: 4 }],
  "max-nested-callbacks": ["warn", { max: 3 }],

  // --- Quality rules (AGENTS.md §1.4) -------------------------------------
  "no-magic-numbers": [
    "warn",
    {
      ignore: [-1, 0, 1, 2, 4, 5, 32, 64, 100, 200, 420, 768, 900, 1024, 1280, 1000, 2000, 5000],
      ignoreArrayIndexes: true,
      ignoreDefaultValues: true,
      ignoreClassFieldInitialValues: true,
      enforceConst: false,
    },
  ],
  "no-duplicate-imports": ["error", { includeExports: false }],
  "no-useless-constructor": "error",
  "no-unused-expressions": ["error", { allowTaggedTemplates: true, enforceForJSX: true }],
  "prefer-template": "error",
  "prefer-object-spread": "error",
  "prefer-spread": "error",
  "prefer-destructuring": ["warn", { array: false, object: true }],
  "no-iterator": "error",
  "no-restricted-globals": ["error", "event", "fdescribe"],
  "no-restricted-properties": [
    "error",
    {
      object: "process",
      property: "exit",
      message: "Do not call process.exit() directly. Use the graceful shutdown handler.",
    },
  ],

  // --- Immutability rules (AGENTS.md §1.3) --------------------------------
  // Block in-place mutation of arrays and objects. Tests relax these.
  //
  // --- Coding standard rules (AGENTS.md §1.4) ------------------------------
  // Capitalised constructor names are valid as values (`new Map()`), but
  // forbidden as TYPE annotations. The lowercase forms are interfaces and
  // safer.
  "no-restricted-syntax": [
    "error",
    // Immutability.
    {
      selector: "MemberExpression[object.property.name='push']",
      message: "Array.push mutates in place. Use spread or concat for immutability.",
    },
    {
      selector: "MemberExpression[property.name='pop']",
      message: "Array.pop mutates in place. Use slice/filter for immutability.",
    },
    {
      selector: "MemberExpression[property.name='shift']",
      message: "Array.shift mutates in place. Use slice/filter for immutability.",
    },
    {
      selector: "MemberExpression[property.name='unshift']",
      message: "Array.unshift mutates in place. Use spread for immutability.",
    },
    {
      selector: "MemberExpression[property.name='splice']",
      message: "Array.splice mutates in place. Use slice/concat/filter for immutability.",
    },
    {
      selector: "MemberExpression[property.name='sort']",
      message: "Array.sort mutates in place. Use toSorted() (ES2023) or [...arr].sort().",
    },
    {
      selector: "MemberExpression[property.name='reverse']",
      message: "Array.reverse mutates in place. Use toReversed() (ES2023) or [...arr].reverse().",
    },
    {
      selector: "MemberExpression[property.name='fill']",
      message: "Array.fill mutates in place. Use map or a fresh array.",
    },
    {
      selector: "MemberExpression[object.name='Object'][property.name='assign']",
      message: "Object.assign mutates the first argument. Use spread ({...a, ...b}).",
    },
    // Coding standard: no constructor types.
    {
      selector: "TSTypeReference[typeName.name='Function']",
      message: "Use a specific function type with explicit parameters instead of `Function`.",
    },
    {
      selector: "TSTypeReference[typeName.name='Object']",
      message: "Use `Record<string, unknown>` or a specific interface instead of `Object`.",
    },
    {
      selector: "TSTypeReference[typeName.name='Boolean']",
      message: "Use `boolean` (lowercase) instead of the `Boolean` wrapper type.",
    },
    {
      selector: "TSTypeReference[typeName.name='Number']",
      message: "Use `number` (lowercase) instead of the `Number` wrapper type.",
    },
    {
      selector: "TSTypeReference[typeName.name='String']",
      message: "Use `string` (lowercase) instead of the `String` wrapper type.",
    },
    {
      selector: "TSTypeReference[typeName.name='Symbol']",
      message: "Use `symbol` (lowercase) instead of the `Symbol` wrapper type.",
    },
  ],
};

/** @typescript-eslint rules layered on top of `baseTsRules`. */
const tsRules = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "warn",
  // Typed-lint rules (no-unsafe-*, no-floating-promises, no-unnecessary-condition,
  // require-await, await-thenable, return-await, restrict-template-expressions) are
  // enforced by `tsc --strict` at build time. Including them in ESLint would require
  // per-file parserOptions.project setup which is fragile across a pnpm monorepo;
  // tsc gives us the same coverage at zero config cost. Re-enable here when we have
  // a per-package lint:typed script.
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-enum-comparison": "off",
  "@typescript-eslint/no-floating-promises": "off",
  "@typescript-eslint/no-misused-promises": "off",
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/await-thenable": "off",
  "@typescript-eslint/return-await": "off",
  "@typescript-eslint/no-unnecessary-condition": "off",
  "@typescript-eslint/restrict-template-expressions": "off",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/explicit-module-boundary-types": "off",
  "@typescript-eslint/no-empty-function": ["error", { allow: ["arrowFunctions"] }],
  "@typescript-eslint/no-shadow": ["error", { builtinGlobals: false, hoist: "functions" }],
  "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
  "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
  // Coding standard (AGENTS.md §1.4).
  "@typescript-eslint/consistent-type-assertions": [
    "error",
    { assertionStyle: "as", objectLiteralTypeAssertions: "allow-as-parameter" },
  ],
  "@typescript-eslint/promise-function-async": "off",
  "@typescript-eslint/consistent-indexed-object-style": ["error", "record"],
  "@typescript-eslint/no-duplicate-enum-values": "error",
};

// ---------------------------------------------------------------------------
// Config.
// ---------------------------------------------------------------------------

export default [
  // Always: ignore generated and vendored paths so the linter doesn't drown.
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.cache/**",
      "**/postgres-data/**",
      "_bmad/**",
      "_bmad-output/**/.working/**",
      "pnpm-lock.yaml",
      // Node tooling scripts use `process` / `URL` / `node:fs` etc.
      // They are linted by their own runner (e.g. `node scripts/lint-prose.mjs`)
      // rather than ESLint's TS rule set, which would false-positive on every
      // Node global.
      "scripts/**",
    ],
  },

  // 1. Base JS rules — every JS/TS file.
  js.configs.recommended,

  // 2. TypeScript recommended + strict-but-pragmatic.
  ...tseslint.configs.recommended,

  // 3. Apply the project rule sets to TS/TSX files.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        // Untyped linting — typed rules run via tsc, not ESLint, to keep
        // the pnpm-workspace config simple. Re-enable per-package when
        // Story 6.5's coverage work adds typed lint to CI.
        project: false,
        projectService: false,
      },
      globals: {
        // Browser globals for the web package.
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        process: "readonly",
        Buffer: "readonly",
        global: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        queueMicrotask: "readonly",
      },
    },
    rules: {
      ...baseTsRules,
      ...tsRules,
    },
  },

  // 3b. Coding standard — unicorn rules + import ordering.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: {
      unicorn,
      import: importPlugin,
    },
    rules: {
      // --- Naming convention is enforced via @typescript-eslint/naming-convention
      // in the tsRules block above (the unicorn plugin removed naming-convention
      // in v56+; typescript-eslint covers the same selectors with TS-aware checks).
      "unicorn/naming-convention": "off",

      // --- Function scoping (unicorn/consistent-function-scoping) ---------
      // Don't define an arrow inside a function body when a top-level
      // function would do. Catches the JSX-inline-function pattern.
      "unicorn/consistent-function-scoping": "error",

      // --- Array callback discipline --------------------------------------
      "unicorn/no-array-callback-reference": "warn",
      // We prefer forEach to for loops in some cases (declarative); but
      // for...of is preferred when break/continue is needed. This rule
      // is "warn" and disabled for tests.
      "unicorn/no-array-for-each": "off",

      // --- node: protocol -------------------------------------------------
      "unicorn/prefer-node-protocol": "error",

      // --- Event target ---------------------------------------------------
      "unicorn/prefer-event-target": "error",

      // --- Throw new Error -----------------------------------------------
      "unicorn/throw-new-error": "error",

      // --- Import ordering -----------------------------------------------
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
          distinctGroup: true,
          named: true,
        },
      ],
      // Forbid cycle references across epic boundaries. Same as the
      // import/no-restricted-paths enforcement above; this one fires when
      // someone uses `import x from "../<other-epic>/..."` inside their own
      // epic directory. (The deeper rule is in the dedicated block below.)
      "import/no-self-import": "error",
      "import/no-useless-path-segments": "error",

      // --- File-name enforcement -----------------------------------------
      // PascalCase for files that export a default React component.
      // camelCase or kebab-case for utilities. Enforced via restricted syntax
      // because naming-convention doesn't see filenames.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program > ExportDefaultDeclaration > Identifier",
          message:
            "Default-exported identifiers must be PascalCase (component) or camelCase (utility). Check the file name.",
        },
      ],
    },
  },

  // 4. React-specific rules for packages/web.
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // not needed with the new JSX transform
      "react/prop-types": "off", // TypeScript handles this
      "react/display-name": "off",
      "react/jsx-key": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/no-unescaped-entities": ["error", { forbid: [">", "}"] }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "jsx-a11y/anchor-is-valid": "off", // our router handles <a> links
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",

      // --- React component size (AGENTS.md §1.1) ----------------------------
      // Flag JSX trees that are too deep — a strong "split this component" signal.
      "react/jsx-max-depth": ["warn", { max: 6 }],
      // No boolean trap in props — if a component has too many boolean toggles,
      // it's doing too much. Use a discriminated union instead.
      "react/boolean-prop-naming": ["warn", { rule: "^is[A-Z]([A-Z0-9]?[a-z0-9]+|[A-Z])$" }],
      // Forbid "any" inside JSX attributes — typed props only.
      "react/no-unknown-property": "error",
      // Forbid nested components defined inside another component — they
      // re-create on every render and are a common AI-agent mistake.
      "react/no-unstable-nested-components": ["error", { allowAsProps: false }],
      // Forbid inline styles when not dynamic — push design tokens.
      "react/forbid-dom-props": ["warn", { forbid: ["id"] }],
    },
  },

  // 4b. JSX hex-literal guard for packages/web (separate block so it
  // doesn't merge with the unicorn `no-restricted-syntax` array and
  // confuse ESLint's unused-disable directive tracker).
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='style'] ObjectExpression Property[key.name=/^(backgroundColor|color|borderColor)$/] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Hex literal in JSX style prop bypasses the design-token system. Use a Tailwind class (bg-neutral-surface, text-severity-critical-value, border-neutral-border, etc.). If a gradient is required, use backgroundImage (Tailwind has no gradient utility).",
        },
      ],
    },
  },

  // 5. Node-specific rules for packages/api and packages/simulator.
  {
    files: ["packages/api/**/*.ts", "packages/simulator/**/*.ts"],
    plugins: { n: nodePlugin },
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        global: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
      },
    },
    rules: {
      // eslint-plugin-n's `node-builtins` table flags `fetch` as
      // experimental-until-Node-21, but Node 20+ ships fetch as a
      // stable global. The api and simulator runtimes target Node 20+.
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-deprecated-api": "error",
      "n/no-missing-import": "off",
      "n/no-extraneous-import": "off",
    },
  },

  // 6. Import-boundary enforcement (the cross-cutting rule from CONTRIBUTING.md).
  //    Prevents one epic's source from importing types from another epic's
  //    directory. Cross-epic types MUST live in packages/shared.
  {
    files: [
      "packages/api/src/**/*.ts",
      "packages/web/src/**/*.ts",
      "packages/simulator/src/**/*.ts",
    ],
    plugins: { import: importPlugin },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // Epic 1 (Auth & Identity) cannot reach into Epic 2..6 internals.
            {
              target: "./packages/api/src/auth",
              from: [
                "./packages/api/src/ingestion",
                "./packages/api/src/rules",
                "./packages/api/src/alerts",
                "./packages/api/src/workflow",
                "./packages/api/src/admin",
              ],
              message: "Cross-epic import blocked (CONTRIBUTING.md). Use packages/shared.",
            },
            {
              target: "./packages/api/src/ingestion",
              from: [
                "./packages/api/src/auth",
                "./packages/api/src/rules",
                "./packages/api/src/alerts",
                "./packages/api/src/workflow",
                "./packages/api/src/admin",
              ],
              message: "Cross-epic import blocked (CONTRIBUTING.md). Use packages/shared.",
            },
            {
              target: "./packages/api/src/rules",
              from: [
                "./packages/api/src/auth",
                "./packages/api/src/ingestion",
                "./packages/api/src/alerts",
                "./packages/api/src/workflow",
                "./packages/api/src/admin",
              ],
              message: "Cross-epic import blocked (CONTRIBUTING.md). Use packages/shared.",
            },
            {
              target: "./packages/api/src/alerts",
              from: [
                "./packages/api/src/auth",
                "./packages/api/src/ingestion",
                "./packages/api/src/rules",
                "./packages/api/src/workflow",
                "./packages/api/src/admin",
              ],
              message: "Cross-epic import blocked (CONTRIBUTING.md). Use packages/shared.",
            },
            {
              target: "./packages/api/src/workflow",
              from: [
                "./packages/api/src/auth",
                "./packages/api/src/ingestion",
                "./packages/api/src/rules",
                "./packages/api/src/alerts",
                "./packages/api/src/admin",
              ],
              message: "Cross-epic import blocked (CONTRIBUTING.md). Use packages/shared.",
            },
            {
              target: "./packages/api/src/admin",
              from: [
                "./packages/api/src/auth",
                "./packages/api/src/ingestion",
                "./packages/api/src/rules",
                "./packages/api/src/alerts",
                "./packages/api/src/workflow",
              ],
              message: "Cross-epic import blocked (CONTRIBUTING.md). Use packages/shared.",
            },
          ],
        },
      ],
    },
  },

  // 7. Tests: relax rules that fight test code.
  {
    files: [
      "**/__tests__/**/*.ts",
      "**/__tests__/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/test/**/*.ts",
      "**/test/**/*.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      "no-magic-numbers": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
      "max-nested-callbacks": "off",
      "max-depth": "off",
      "max-params": "off",
      "max-classes-per-file": "off",
      "react/jsx-max-depth": "off",
      "unicorn/naming-convention": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-callback-reference": "off",
      "import/order": "off",
      "import/no-self-import": "off",
      "import/no-useless-path-segments": "off",
      // Tests legitimately build up fixtures via push.
      "no-restricted-syntax": "off",
    },
  },

  // 7b. Tooling configs (vitest.config.ts, etc.) — relax lint rules that don't
  // make sense for build configs.
  {
    files: ["**/vitest.config.ts", "**/playwright.config.ts", "**/vite.config.ts"],
    rules: {
      "no-magic-numbers": "off",
    },
  },

  // 8. JSON / JSONC (settings, tsconfig, lint configs themselves).
  {
    files: ["**/*.json", "**/*.jsonc"],
    languageOptions: {
      parser: await import("jsonc-eslint-parser").then((m) => m.default).catch(() => undefined),
    },
    rules: {
      "no-unused-expressions": "off",
    },
  },

  // 9. Prettier last — disables any stylistic ESLint rules that conflict.
  prettier,
];
