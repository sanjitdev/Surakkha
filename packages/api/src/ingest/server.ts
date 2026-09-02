/**
 * Socket.IO ingest server.
 *
 * The WS upgrade is claim-driven (not the HTTP RBAC middleware —
 * device `sub`s are not `User` rows). Reads the URL `/ingest/{device_id}`
 * + `?token=` query, calls `verifyIngestClaims(token, deviceId)`,
 * registers a `frame` listener that delegates to `processFrame`.
 *
 * The connection's URL `device_id` is the authority for room naming
 * (`device:<device_id>`) and is NEVER trusted from the JWT `sub` alone.
 */
import { isUuidV4 } from "@surakkha/shared";
import { type Server as IoServer } from "socket.io";

import { verifyIngestClaims } from "../auth/jwt";

import { type BroadcastTarget, processFrame, type ReadingRepository } from "./frame";
import { getIngestHooks } from "./hooks";
import { PerDeviceRateLimiter } from "./rateLimit";
import { PerDeviceSequence } from "./sequence";

/** Ingest namespace constants — single source of truth for path matching. */
export const INGEST_PATH_PREFIX = "/ingest/";

export interface BuildIngestServerDeps {
  readonly io: IoServer;
  readonly prisma: ReadingRepository;
  readonly broadcastOverride?: BroadcastTarget;
  readonly rateLimiter?: PerDeviceRateLimiter;
  readonly sequence?: PerDeviceSequence;
}

/** Stripped-shape Socket.IO socket. We use `unknown` at the seam so
 *  tests can pass a stub without depending on the real Socket type. */
interface MinimalSocket {
  readonly id: string;
  readonly handshake: {
    readonly url?: string;
    readonly auth?: Record<string, unknown>;
    readonly query?: Record<string, unknown>;
  };
  readonly on: (event: string, listener: (arg: unknown) => void) => void;
  readonly emit: (event: string, ...args: unknown[]) => unknown;
  readonly disconnect: (close?: boolean) => unknown;
  readonly data: Record<string, unknown>;
}

/**
 * Extract the device_id from the connection handshake.
 *
 * Priority: `auth.device_id` → URL path segment after `ingest`. The
 * URL path / query remains a secondary source for backward compat
 * with older clients that still hit `/ingest/<uuid>?token=…`.
 */
const parseDeviceIdFromHandshake = (socket: MinimalSocket): string => {
  const authDeviceId = socket.handshake.auth?.["device_id"];
  if (typeof authDeviceId === "string" && authDeviceId !== "") {
    return authDeviceId;
  }
  const url = socket.handshake.url ?? "";
  const parsedUrl = new URL(url, "http://localhost");
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const ingestIdx = pathSegments.indexOf("ingest");
  return ingestIdx >= 0 ? (pathSegments[ingestIdx + 1] ?? "") : "";
};

/** Extract the bearer token. Either `auth.token` (recommended) or
 *  `?token=` query (legacy / simulator path) is accepted. */
const extractToken = (socket: MinimalSocket): string | null => {
  const authToken = socket.handshake.auth?.["token"];
  const queryToken = socket.handshake.query?.["token"];
  if (typeof authToken === "string") return authToken;
  if (typeof queryToken === "string") return queryToken;
  return null;
};

/** Build a Socket.IO connection handler for `/ingest/{device_id}`. */
export const buildIngestServer = (
  deps: BuildIngestServerDeps,
): ((socket: unknown) => Promise<void>) => {
  const rateLimiter = deps.rateLimiter ?? new PerDeviceRateLimiter();
  const sequence = deps.sequence ?? new PerDeviceSequence();
  const { io } = deps;
  const { prisma } = deps;

  const broadcast: BroadcastTarget = deps.broadcastOverride ?? {
    to(room: string) {
      return {
        emit(event: string, payload: unknown): unknown {
          io.to(room).emit(event, payload);
          return undefined;
        },
      };
    },
  };

  return async (rawSocket: unknown): Promise<void> => {
    const socket = rawSocket as MinimalSocket;
    const urlDeviceId = parseDeviceIdFromHandshake(socket);
    const token = extractToken(socket);

    if (urlDeviceId === "" || !isUuidV4(urlDeviceId) || token === null) {
      socket.emit("unauthenticated");
      socket.disconnect(true);
      return;
    }

    const result = verifyIngestClaims(token, urlDeviceId);
    if (result.kind !== "ok") {
      // Differentiate failure modes so the device / simulator gets an
      // actionable error envelope. Signature / audience failures mean
      // "we didn't issue this for the ingest path" → `unauthenticated`.
      // Scope / sub failures mean "the token IS for ingest but doesn't
      // authorise this connection" → `auth_error` with a code so
      // operators triaging device mis-configs can tell "wrong device_id"
      // apart from "wrong scope".
      if (result.kind === "sig_fail" || result.kind === "aud_fail") {
        socket.emit("unauthenticated");
      } else if (result.kind === "scope_fail") {
        socket.emit("auth_error", { error: "forbidden_scope" });
      } else {
        socket.emit("auth_error", { error: "device_id_mismatch" });
      }
      socket.disconnect(true);
      return;
    }
    const { claims } = result;

    socket.data["ingestClaims"] = claims;

    socket.on("frame", (raw: unknown) => {
      // The WS endpoint is bidirectional-writes-only: the server does
      // NOT accept any client → server commands except the frame.
      // Attach a .catch so any throw inside the 10-step driver surfaces
      // as a logged warning + disconnect instead of an unhandled
      // promise rejection.
      processFrame({
        deviceId: urlDeviceId,
        socket: {
          emit: (event, payload) => socket.emit(event, payload),
          disconnect: (close) => socket.disconnect(close),
        },
        raw,
        rateLimiter,
        sequence,
        prisma,
        io: broadcast,
        hooks: getIngestHooks(),
      }).catch((err: unknown) => {
        socket.emit("internal_error", { error: "internal_error" });
        socket.disconnect(true);
        console.error("ingest: processFrame threw", err);
      });
    });
  };
};
