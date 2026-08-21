/**
 * Surakkha api — entry point.
 *
 * Boots an Express app on `PORT` (default 3000) and exposes:
 *   GET  /health         — Docker Compose healthcheck (unchanged from Step 0)
 *   POST /auth/login     — Story 1.4 (issues access token + refresh cookie)
 *   POST /auth/refresh   — Story 1.4 (mints a new access token from cookie)
 *   GET  /devices        — Story 1.5 (RBAC-protected demo endpoint)
 *
 * Story 1.4 AC: JWT_SECRET fail-fast — the process exits with code 1
 * if the env var is missing, empty, or shorter than 32 characters
 * (`@surakkha/shared/auth` exports `JWT_SECRET_MIN_LENGTH`). The check
 * runs BEFORE Express is constructed so no sockets are bound.
 *
 * Story 1.5 wiring:
 *   1. `authenticate()` runs on every request.
 *   2. Routes mounted under `/auth` mark their handlers PUBLIC so the
 *      login + refresh endpoints remain anonymous.
 *   3. Protected routes are wrapped with `authorize({ action, resource })`
 *      which writes a `rbac_denied` audit row on every denial.
 */
import { createLogger } from "@surakkha/shared/logger";
import cookieParser from "cookie-parser";
import express, { type Express, type Request, type Response } from "express";


import { type AuditLogger } from "./audit";
import { assertJwtSecret } from "./auth/jwt";
import { buildAuthRouter } from "./auth/router";
import { authenticate, authorize } from "./middleware/authorize";

const DEFAULT_API_PORT = 3000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const PORT = Number(process.env["PORT"] ?? DEFAULT_API_PORT);

// Fail-fast — must precede Express construction (Story 1.4 AC + FR-25).
assertJwtSecret();

const logger = createLogger({ name: "surakkha-api", level: "info" });

/**
 * v1 audit emitter — writes a structured log line that the audit-log
 * pipeline (Story 5.6) consumes. v2 will write to the database.
 */
const audit: AuditLogger = {
  emit(event) {
    logger.info({ audit: event }, `audit:${event.auditAction}`);
  },
};

const app: Express = express();
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
// The auth router must mount BEFORE `authenticate` so the
// `markPublic()` wrapper on `/login` and `/refresh` sets
// `req.public = true` ahead of the bearer-token check.
app.use("/auth", buildAuthRouter({ audit }));
app.use(authenticate);

/**
 * Demo protected endpoint — Story 1.5. The real `/devices` surface
 * (Epic 2) will land its own router with the same authorize gate.
 * This stub exists so curl can prove the wiring without spinning up
 * the full ingestion stack.
 */
app.get(
  "/devices",
  authorize({ action: "read", resource: "Device" }, audit),
  (_req: Request, res: Response) => {
    res.status(HTTP_OK).json({ devices: [] });
  },
);

app.get("/health", (_req: Request, res: Response) => {
  res.status(HTTP_OK).json({ status: "ok", service: "surakkha-api" });
});

// Final 404 — the same shape the Step 0 stub returned, so the Docker
// healthcheck contract is unchanged.
app.use((_req: Request, res: Response) => {
  res.status(HTTP_NOT_FOUND).json({ error: "not_found" });
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, "api: listening");
});

export { app };