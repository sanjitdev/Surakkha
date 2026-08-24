/**
 * Public surface of `@surakkha/shared`.
 *
 * Every epic imports cross-epic types from this entry point only. The ESLint
 * `import/no-restricted-paths` rule enforces that no epic imports from another
 * epic's directory directly (ADR 0007).
 */
export * from "./telemetry.js";
export * from "./auth.js";
export * from "./events.js";
export * from "./incident.js";
export * from "./rbac.js";
export * from "./logger.js";
export * from "./simulator.js";
export * from "./dashboard.js";
