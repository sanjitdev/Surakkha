/**
 * `AuditLogger` implementation that persists every `audit.emit`
 * to the `AuditLog` table. Wire contract is unchanged:
 * `emit({ auditAction, userId?, outcome, context? })`.
 *
 * Lazy Prisma resolution mirrors `boot/db.ts` — a transient DB
 * outage at boot does not crash the api. Resolver rejections and
 * per-emit write rejections are swallowed + logged as
 * `audit_log_write_failed` (the audit trail is best-effort;
 * failing the parent request because the audit write failed is
 * wrong).
 */
import { type AuditLogResource } from "@surakkha/shared/audit";
import { type AuditAction } from "@surakkha/shared/rbac";

import { type AuditLogger } from "../audit.js";

import { auditActionResourceMap } from "./auditActionResourceMap.js";

/** Minimal logger surface the writer needs — just `warn`. */
export interface AuditLoggerSink {
  readonly warn: (obj: unknown, msg?: string) => void;
}

/** Narrow Prisma slice the writer depends on — `auditLog.create` only. */
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

export interface AuditLogWriterDeps {
  readonly resolvePrismaClient: () => Promise<unknown>;
  readonly logger: AuditLoggerSink;
}

/**
 * Resolve `{ resource, resourceId }` for an emit. Returns the
 * mapped resource plus the `context[resourceIdKey]` value, or
 * `null` if the action is resource-less, the key is missing /
 * non-string, or the value is whitespace-only.
 */
export const resolveResourceBinding = (
  auditAction: AuditAction,
  context: Record<string, unknown> | undefined,
): { readonly resource: AuditLogResource; readonly resourceId: string | null } => {
  const entry = auditActionResourceMap[auditAction];
  if (entry.resourceIdKey === null) {
    return { resource: entry.resource, resourceId: null };
  }
  const raw = context?.[entry.resourceIdKey];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { resource: entry.resource, resourceId: null };
  }
  return { resource: entry.resource, resourceId: raw };
};

export const createAuditLogWriter = (deps: AuditLogWriterDeps): AuditLogger => {
  const { resolvePrismaClient, logger } = deps;
  let cachedClient: AuditLogCreateClient | null = null;

  const ensureClient = async (): Promise<AuditLogCreateClient | null> => {
    if (cachedClient !== null) return cachedClient;
    try {
      cachedClient = (await resolvePrismaClient()) as AuditLogCreateClient;
      return cachedClient;
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
          // Failure-path log carries the full resource binding so
          // an SRE inspecting `audit_log_write_failed` lines can
          // recover the dropped row.
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
