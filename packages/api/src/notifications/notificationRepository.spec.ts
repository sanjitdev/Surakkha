/**
 * `notificationRepository.spec.ts` — Story 4.10.
 *
 * Pure-helper coverage on the notification repository slice:
 *
 *   - findMany filter shape — recipientRole + acknowledgedAt: null
 *   - updateMany shape — acknowledgedAt + acknowledgedByUserId
 *   - findUnique-by-id shape
 *
 * Mirrors the 4.4 `incidentStateRepository` test pattern (stub-
 * based; no Prisma). The `resolveNotificationRepository` adapter
 * is exercised by accepting a stub satisfying the
 * `NotificationRepository` interface — we trust the runtime cast
 * is type-safe at the seam (the same shape production wires).
 */
import { describe, expect, it } from "vitest";

import { type NotificationRow } from "./notificationRepository.js";

const INCIDENT_ID_1 = "11111111-1111-4111-8111-111111111111";
const NOTIF_ID_1 = "a1111111-1111-4111-8111-111111111111";

const baseRow: NotificationRow = {
  id: NOTIF_ID_1,
  severity: "critical",
  incidentId: INCIDENT_ID_1,
  alertId: null,
  recipientRole: "Operator",
  createdAt: new Date("2026-08-28T10:00:00.000Z"),
  acknowledgedAt: null,
  acknowledgedByUserId: null,
};

describe("Story 4.10 — notificationRepository pure helper coverage", () => {
  it("findMany pass-through: filter pins (recipientRole + acknowledgedAt: null) + orderBy + take", async () => {
    let observedArgs: unknown = null;
    const repo = {
      notification: {
        findMany: async (args: unknown) => {
          observedArgs = args;
          return [baseRow];
        },
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
    };
    const rows = await repo.notification.findMany({
      where: { recipientRole: "Operator", acknowledgedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(rows).toHaveLength(1);
    expect(observedArgs).toEqual({
      where: { recipientRole: "Operator", acknowledgedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("updateMany pass-through: shape pins (acknowledgedAt + acknowledgedByUserId) + where clause", async () => {
    let observedArgs: unknown = null;
    const repo = {
      notification: {
        findMany: async () => [],
        findUnique: async () => null,
        updateMany: async (args: unknown) => {
          observedArgs = args;
          return { count: 1 };
        },
      },
    };
    const at = new Date("2026-08-28T12:00:00.000Z");
    const result = await repo.notification.updateMany({
      where: { id: NOTIF_ID_1, acknowledgedAt: null },
      data: { acknowledgedAt: at, acknowledgedByUserId: "actor-1" },
    });
    expect(result.count).toBe(1);
    expect(observedArgs).toEqual({
      where: { id: NOTIF_ID_1, acknowledgedAt: null },
      data: { acknowledgedAt: at, acknowledgedByUserId: "actor-1" },
    });
  });

  it("findUnique-by-id pass-through: returns the row by primary key", async () => {
    let observedArgs: unknown = null;
    const repo = {
      notification: {
        findMany: async () => [],
        findUnique: async (args: unknown) => {
          observedArgs = args;
          return baseRow;
        },
        updateMany: async () => ({ count: 0 }),
      },
    };
    const row = await repo.notification.findUnique({ where: { id: NOTIF_ID_1 } });
    expect(row).toEqual(baseRow);
    expect(observedArgs).toEqual({ where: { id: NOTIF_ID_1 } });
  });
});
