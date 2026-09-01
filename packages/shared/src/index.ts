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
export * from "./notification.js";
export * from "./rbac.js";
export * from "./logger.js";
export * from "./simulator.js";
export * from "./dashboard.js";
export * from "./rule.js";
export * from "./alerts.js";
export * from "./urlValidation.js";
export * from "./mimeAutoDetect.js";
export * from "./attachment.js";
export * from "./error-envelope.js";
export * from "./schemas.js";
