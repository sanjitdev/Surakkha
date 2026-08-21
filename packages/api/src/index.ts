/**
 * Surakkha api — entry point.
 *
 * Boots an Express app on `PORT` (default 3000) and exposes:
 *   GET  /health         — Docker Compose healthcheck (unchanged from Step 0)
 *   POST /auth/login     — Story 1.4 (issues access token + refresh cookie)
 *   POST /auth/refresh   — Story 1.4 (mints a new access token from cookie)
 *
 * Story 1.4 AC: JWT_SECRET fail-fast — the process exits with code 1
 * if the env var is missing, empty, or shorter than 32 characters
 * (`@surakkha/shared/auth` exports `JWT_SECRET_MIN_LENGTH`). The check
 * runs BEFORE Express is constructed so no sockets are bound.
 *
 * Stories 2.x (ingestion, rules, alerts, workflow, admin) mount their
 * own routers here; Story 1.5's RBAC middleware sits between this
 * bootstrap and the per-route handlers.
 */
import { createLogger } from "@surakkha/shared/logger";
import cookieParser from "cookie-parser";
import express, { type Request, type Response } from "express";


import { assertJwtSecret } from "./auth/jwt";
import { type AuditLogger, buildAuthRouter } from "./auth/router";

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

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use("/auth", buildAuthRouter({ audit }));

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