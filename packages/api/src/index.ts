/**
 * Surakkha api — entry point.
 *
 * Real implementation lands in Story 1.4 (JWT Auth + Refresh) and Story 2.2
 * (Ingest WebSocket Endpoint). This stub boots the HTTP server on the
 * configured port and exposes a /health endpoint so Docker Compose can
 * healthcheck the api container before the simulator and web start.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createLogger } from "@surakkha/shared/logger";

const DEFAULT_API_PORT = 3000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const PORT = Number(process.env.PORT ?? DEFAULT_API_PORT);
const logger = createLogger({ name: "surakkha-api", level: "info" });

const writeJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
): void => {
  // ServerResponse is the canonical handle; `no-param-reassign` is the
  // general rule for in-process state, but a ServerResponse is the IO layer.
  /* eslint-disable no-param-reassign */
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(body));
  /* eslint-enable no-param-reassign */
};

const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
  if (req.url === "/health") {
    writeJson(res, HTTP_OK, { status: "ok", service: "surakkha-api" });
    return;
  }
  writeJson(res, HTTP_NOT_FOUND, { error: "not_found" });
};

const server = createServer(handleRequest);

server.listen(PORT, () => {
  logger.info({ port: PORT }, "api: listening");
});

export {};
