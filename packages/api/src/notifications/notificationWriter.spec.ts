/**
 * notificationWriter.spec.ts — Story 4.9 (unit tests).
 *
 * Covers:
 *   - AC2: happy-path `notification:critical` write returns a new row.
 *   - AC3: `notification:warning` write site reuses the same writer.
 *   - AC5: idempotent double-click returns the existing row on
 *     P2002 collision (`wasInserted: false`).
 *   - AC5 edge: race between failed insert and refetch (active row
 *     was acknowledged in between) — the writer retries with a
 *     fresh insert.
 *   - null `incidentId` falls through to a non-indexed write.
 */
import { describe, expect, it } from "vitest";

import {
  type NotificationWriterRepository,
  type WriteNotificationOutput,
  writeCriticalNotification,
  writeNotification,
  writeWarningNotification,
} from "./notificationWriter.js";

class FakeP2002Error extends Error {
  public readonly code = "P2002";
  constructor(public readonly meta?: unknown) {
    super("Unique constraint failed");
  }
}

const makeMockRepo = (
  overrides: Partial<NotificationWriterRepository["notification"]> = {},
): NotificationWriterRepository & {
  createCalls: number;
  findFirstCalls: number;
} => {
  let createCalls = 0;
  let findFirstCalls = 0;
  const baseRow = {
    id: "notif-aaaa-bbbb-cccc-dddddddddddd",
    createdAt: new Date("2026-08-27T00:00:00.000Z"),
  };
  const repo = {
    notification: {
      create: async (
        args: Parameters<NotificationWriterRepository["notification"]["create"]>[0],
      ) => {
        createCalls += 1;
        if (overrides.create !== undefined) return overrides.create(args);
        return baseRow;
      },
      findFirst: async (
        args: Parameters<NotificationWriterRepository["notification"]["findFirst"]>[0],
      ) => {
        findFirstCalls += 1;
        if (overrides.findFirst !== undefined) return overrides.findFirst(args);
        return null;
      },
    },
    createCalls: 0,
    findFirstCalls: 0,
  };
  // Sync the proxy props back to the closures.
  Object.defineProperty(repo, "createCalls", {
    get() {
      return createCalls;
    },
  });
  Object.defineProperty(repo, "findFirstCalls", {
    get() {
      return findFirstCalls;
    },
  });
  return repo as NotificationWriterRepository & {
    createCalls: number;
    findFirstCalls: number;
  };
};

describe("Story 4.9 — writeNotification happy path (AC2, AC3)", () => {
  it("writeCriticalNotification returns a new row with wasInserted: true", async () => {
    const repo = makeMockRepo();
    const out = await writeCriticalNotification(repo, { incidentId: "inc-1", alertId: null });
    expect(out.wasInserted).toBe(true);
    expect(out.id).toBe("notif-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("writeWarningNotification reuses the same writer", async () => {
    const repo = makeMockRepo();
    const out = await writeWarningNotification(repo, { incidentId: "inc-1", alertId: "alert-1" });
    expect(out.wasInserted).toBe(true);
  });

  it("null incidentId falls through to a non-indexed write", async () => {
    const repo = makeMockRepo();
    const out = await writeNotification(repo, {
      severity: "critical",
      incidentId: null,
      alertId: "alert-1",
    });
    expect(out.wasInserted).toBe(true);
  });

  it("Pins recipientRole=Operator on every write (call-site can never override)", async () => {
    let observedRole: string | null = null;
    const repo = makeMockRepo({
      create: async (args) => {
        observedRole = args.data.recipientRole;
        return { id: "n", createdAt: new Date() };
      },
    });
    await writeCriticalNotification(repo, { incidentId: "inc-1", alertId: null });
    expect(observedRole).toBe("Operator");
  });
});

describe("Story 4.9 — writeNotification idempotent double-click (AC5)", () => {
  it("Returns the existing row on P2002 collision (wasInserted: false)", async () => {
    const repo = makeMockRepo({
      create: async () => {
        throw new FakeP2002Error();
      },
      findFirst: async () => ({
        id: "notif-existing-aaaa-bbbb-cccc-dddddddddddd",
        createdAt: new Date("2026-08-27T00:00:00.000Z"),
      }),
    });
    const out: WriteNotificationOutput = await writeCriticalNotification(repo, {
      incidentId: "inc-1",
      alertId: null,
    });
    expect(out.wasInserted).toBe(false);
    expect(out.id).toBe("notif-existing-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("Re-inserts when the race refetch finds no active row (acknowledged between)", async () => {
    let createCalls = 0;
    const repo = makeMockRepo({
      create: async () => {
        createCalls += 1;
        if (createCalls === 1) throw new FakeP2002Error();
        // Second create (retry) succeeds
        return { id: "notif-retry-aaaa-bbbb-cccc-dddddddddddd", createdAt: new Date() };
      },
      findFirst: async () => null, // active row was acknowledged between
    });
    const out = await writeCriticalNotification(repo, { incidentId: "inc-1", alertId: null });
    expect(out.wasInserted).toBe(true);
    expect(out.id).toBe("notif-retry-aaaa-bbbb-cccc-dddddddddddd");
    expect(createCalls).toBe(2);
  });

  it("Rethrows non-P2002 errors (defense-in-depth)", async () => {
    const repo = makeMockRepo({
      create: async () => {
        throw new Error("some other prisma error");
      },
    });
    await expect(
      writeCriticalNotification(repo, { incidentId: "inc-1", alertId: null }),
    ).rejects.toThrow("some other prisma error");
  });

  it("The partial-index query filters on acknowledgedAt: null", async () => {
    let observedWhere: unknown = null;
    const repo = makeMockRepo({
      create: async () => {
        throw new FakeP2002Error();
      },
      findFirst: async (args) => {
        observedWhere = args.where;
        return {
          id: "notif-existing-aaaa-bbbb-cccc-dddddddddddd",
          createdAt: new Date(),
        };
      },
    });
    await writeCriticalNotification(repo, { incidentId: "inc-1", alertId: null });
    expect(observedWhere).toEqual({
      incidentId: "inc-1",
      severity: "critical",
      acknowledgedAt: null,
    });
  });
});
