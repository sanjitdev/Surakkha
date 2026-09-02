/**
 * `auditLogWriter.ts` — Story 5.6.
 *
 * The v2 `AuditLogger` implementation. Replaces the v1 logger-only
 * emitter in `index.ts` with a Prisma-backed writer that persists
 * every `audit.emit` call to the `AuditLog` table (the same table
 * the Story 5.3 admin-list endpoint reads from).
 *
 * Wire contract (preserved from v1):
 *
 *   `audit.emit({ auditAction, userId?, outcome, context? })`
 *     - Maps `auditAction` → `{ resource, resourceId }` via the
 *       `auditActionResourceMap` table.
 *     - Coercodes `userId: undefined` → `actorUserId: null` (the FK
 *       is nullable per the ON DELETE SET NULL invariant from 5.3).
 *     - Persists the row via the shared Prisma client.
 *     - Swallows DB rejections + emits a structured
 *       `audit_log_write_failed` log line (the audit trail is
 *       best-effort; failing the parent request because the audit
 *       write failed is wrong).
 *
 * Lazy Prisma resolution: the factory takes a `resolvePrismaClient`
 * closure (matching the `boot/db.ts` `getPrisma` precedent) and
 * resolves Prisma on the FIRST `emit` call. A transient DB outage
 * at boot does NOT crash the api (the v1 logger-only emitter
 * already had no boot-time Prisma dependency).
 *
 * The interface itself (`AuditLogger.emit(...)`) is the same
 * single-method contract the v1 emitter shipped. Every existing
 * call site (auth router, RBAC middleware, incidents router,
 * simulator router, etc.) keeps using it — no caller-side changes
 * per the spec's "Never — NO call site changes" rule.
 */
import { type AuditAction } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit.js";

import { auditActionResourceMap } from "./auditActionResourceMap.js";

import type { Logger } from "pino";

/**
 * Narrow Prisma slice the writer needs: a single `auditLog.create`
 * method. Mirrors the test-rig shape so the unit tests can stub it
 * without spinning up the full Prisma client.
 */
export interface AuditLogCreateClient {
  readonly auditLog: {
    readonly create: (args: {
      readonly data: {
        readonly actorUserId: string | null;
        readonly auditAction: string;
        readonly resource: string;
        readonly resourceId: string | null;
        readonly payload: unknown;
        readonly outcome: string;
      };
    }) => Promise<unknown>;
  };
}

/**
 * Factory input. `resolvePrismaClient` mirrors the lazy-resolver
 * pattern at `boot/db.ts:37-49` so the writer does not require
 * Prisma to be resolvable at boot time.
 *
 * `logger` is the shared pino logger; the writer uses it for the
 * structured `audit_log_write_failed` line on DB rejection.
 */
export interface AuditLogWriterDeps {
  readonly resolvePrismaClient: () => Promise<unknown>;
  readonly logger: Logger;
}

/**
 * Pull `resourceId` out of the emit `context`. Returns `null` when
 * the action has no `resourceIdKey` (resource-less actions like
 * `logout`, `rbac_allowed`), when `context` is undefined, when the
 * key is missing, or when the value is a non-string / empty / whitespace-
 * only (per F-5.6-D19: trim whitespace BEFORE the typeof check so a
 * stray `"   "` payload doesn't silently persist as a fake id).
 */
export const resolveResourceId = (
  auditAction: AuditAction,
  context: Record<string, unknown> | undefined,
): string | null => {
  const entry = auditActionResourceMap[auditAction];
  if (entry.resourceIdKey === null) return null;
  if (context === undefined) return null;
  const raw = context[entry.resourceIdKey];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  // F-5.6-D19 — trim whitespace so an action whose context carries
  // `"   "` (or `"\n"`) does not persist a whitespace string as a
  // fake resourceId. A zero-length trim collapses to `null` so
  // the resulting row matches the spec's "no resource binding"
  // default.
  if (raw.trim().length === 0) return null;
  return raw;
};

/**
 * Build the `{ resource, resourceId }` tuple the writer persists.
 * Exported so the unit tests can pin the exact mapping shape.
 */
export const resolveResourceBinding = (
  auditAction: AuditAction,
  context: Record<string, unknown> | undefined,
): { readonly resource: string; readonly resourceId: string | null } => {
  const entry = auditActionResourceMap[auditAction];
  return {
    resource: entry.resource,
    resourceId: resolveResourceId(auditAction, context),
  };
};

/**
 * `createAuditLogWriter({ resolvePrismaClient, logger })` — the v2
 * `AuditLogger` factory. Returns an object with the `emit` method
 * the existing call sites already use.
 *
 * Prisma is resolved on first emit (NOT at factory-call time), and
 * the resolved client is cached for subsequent emits. A rejection
 * on first resolve is treated the same as a per-emit rejection:
 * swallow + log, do NOT crash the caller.
 *
 * Failure mode (matches the spec "Resolved at step-01" decision):
 * swallow + structured `audit_log_write_failed` log line. The
 * audit trail is best-effort; failing the parent's request because
 * the audit write failed is wrong (the action succeeded).
 */
export const createAuditLogWriter = (deps: AuditLogWriterDeps): AuditLogger => {
  const { resolvePrismaClient, logger } = deps;
  let cachedClient: AuditLogCreateClient | null = null;

  const ensureClient = async (): Promise<AuditLogCreateClient | null> => {
    if (cachedClient !== null) return cachedClient;
    try {
      // Mirror `boot/db.ts` — the writer takes `() => Promise<unknown>`
      // and narrows internally via the same structural cast the test
      // rig uses. Keeps the lazy-resolver seam identical to the rest
      // of the api (Story 2.6 / 2.7 / 4.2 / 4.10 use the same shape).
      const resolved = await resolvePrismaClient();
      // Belt-and-braces runtime guard — if the resolved client lacks
      // the `auditLog.create` method (e.g. a future Prisma client
      // shape change, a degraded wrapper, or a stub that doesn't
      // expose the model), the structural cast above would silently
      // succeed and the throw inside `client.auditLog.create` would
      // log a misleading `audit_create` warn. Surface this as a
      // `prisma_resolve` failure so SRE can grep `reason` consistently.
      if (
        resolved === null ||
        resolved === undefined ||
        typeof (resolved as { auditLog?: { create?: unknown } }).auditLog?.create !== "function"
      ) {
        logger.warn(
          { event: "audit_log_write_failed", reason: "prisma_resolve" },
          "audit_log_write_failed: resolved prisma client lacks auditLog.create",
        );
        return null;
      }
      const client = resolved as AuditLogCreateClient;
      cachedClient = client;
      return client;
    } catch (err) {
      logger.warn(
        { err, event: "audit_log_write_failed", reason: "prisma_resolve" },
        "audit_log_write_failed: prisma resolution failed",
      );
      return null;
    }
  };

  return {
    emit(event) {
      // Fire-and-forget — the writer does not await. The spec pins
      // the call interface to `(event) => void` (sync); a rejected
      // promise is unhandled by the caller anyway. The writer
      // internally awaits the Prisma call via an IIFE + .catch.
      const { auditAction, userId, outcome, context } = event;

      const binding = resolveResourceBinding(auditAction, context);

      void (async (): Promise<void> => {
        const client = await ensureClient();
        if (client === null) return;
        try {
          await client.auditLog.create({
            data: {
              actorUserId: userId === undefined ? null : userId,
              auditAction,
              resource: binding.resource,
              resourceId: binding.resourceId,
              payload: context ?? {},
              outcome,
            },
          });
        } catch (err) {
          // F-5.6-D18 — the failure-path log line carries the full
          // resource binding (resource / resourceId / actorUserId)
          // so an SRE inspecting `audit_log_write_failed` lines can
          // tell whether the dropped row was resource-bound (and
          // recover the id from the log line).
          logger.warn(
            {
              err,
              event: "audit_log_write_failed",
              auditAction,
              outcome,
              actorUserId: userId === undefined ? null : userId,
              resource: binding.resource,
              resourceId: binding.resourceId,
            },
            "audit_log_write_failed",
          );
        }
      })();
    },
  };
};
