/**
 * `applyTransition.spec.ts` — Story 4.11 step-04 review.
 *
 * Direct unit tests for the writer in `incidentStateRepository.ts`.
 * The route-level tests (`router.spec.ts`) verify the envelope shape
 * but the `updateMany` mock returns `{ count: 1 }` without inspecting
 * the `data` argument — meaning a regression that dropped the
 * forced-critical severity spread on reopen would pass every existing
 * route-level test while silently violating the load-bearing
 * "Reopened row is critical" contract.
 *
 * This file captures the `data` argument passed to `updateMany`
 * and pins per-verb behaviour:
 *
 *   - `event_type === "reopen"`        → `data.severity === "critical"`
 *   - `event_type === "acknowledge"`   → `data.severity` is OMITTED
 *   - `event_type === "assign"`        → `data.severity` is OMITTED
 *   - `event_type === "submit_result"` → `data.severity` is OMITTED
 *   - `event_type === "resolve"`       → `data.severity` is OMITTED
 *
 * Why a dedicated spec file (not extending
 * `incidentStateRepository.spec.ts`): the existing spec covers the
 * pure serializers (`incidentRowToPayload` /
 * `incidentEventRowToPayload`); this file covers the imperative
 * writer. Different responsibility, different test rig (stubbed
 * `$transaction` vs no Prisma calls at all).
 */
import {
  type ActionVerb,
  IncidentSeveritySchema,
  type IncidentState,
  type TransitionResult,
} from "@surakkha/shared/incident";
import { describe, expect, it } from "vitest";

import {
  applyTransition,
  type IncidentRow,
  type IncidentStateRepository,
} from "./incidentStateRepository";

const TECH_UUID = "tech-aaaa-bbbb-cccc-dddddddddddd";

const baseRow = (overrides: Partial<IncidentRow> = {}): IncidentRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  deviceId: "9b1c4f00-0000-4000-8000-000000000001",
  severity: "warning",
  metric: "tds_ppm",
  value: 312,
  openedAt: new Date("2026-08-27T00:00:00.000Z"),
  state: "OPEN",
  assigneeUserId: null,
  acknowledgedAt: null,
  resolvedAt: null,
  updatedAt: new Date("2026-08-27T00:00:00.000Z"),
  ...overrides,
});

/**
 * Build a successful `TransitionResult` for the given verb. Mirrors
 * the shape of `transition()`'s success arm:
 *
 *   { ok: true, next_state, event_type, event_payload: { actorUserId, ... }, at }
 */
const makeSuccess = (
  verb: ActionVerb,
  nextState: IncidentState,
  eventPayload: Record<string, unknown> = {},
): Extract<TransitionResult, { ok: true }> => ({
  ok: true,
  next_state: nextState,
  event_type: verb,
  event_payload: { actorUserId: TECH_UUID, ...eventPayload },
  at: "2026-08-27T03:00:00.000Z",
});

/**
 * Build a stub `IncidentStateRepository` whose `updateMany.data`
 * is captured for the test to assert against. The `findUnique`
 * side mirrors the row so the post-update `incidentRowToPayload`
 * projection resolves cleanly.
 */
const captureRepo = (
  initialRow: IncidentRow,
  captureSink: { updateData: Record<string, unknown> | null },
): IncidentStateRepository =>
  // The capture sink is mutated by `updateMany`; the same
  // `IncidentStateRepository` is reused for the `$transaction`
  // callback so the captured data reflects the actual write.
  // `no-param-reassign` is disabled because the capture sink IS
  // the channel that lets the test observe writes inside the
  // `$transaction` closure — a return value would lose the
  // propagation across the tx boundary.
  ({
    incident: {
      findUnique: async () => initialRow,
      findMany: async () => [],
      updateMany: async (args) => {
        // eslint-disable-next-line no-param-reassign
        captureSink.updateData = args.data as Record<string, unknown>;
        return { count: 1 };
      },
    },
    incidentEvent: {
      create: async (args) => ({
        id: "event-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        incidentId: args.data.incidentId,
        actorUserId: args.data.actorUserId,
        type: args.data.type,
        payload: args.data.payload,
        createdAt: new Date(),
      }),
    },
    notification: {
      create: async (args) => ({
        id: args.data.id ?? "notification-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        ...args.data,
        createdAt: new Date(),
      }),
    },
    $transaction: async <T>(cb: (tx: IncidentStateRepository) => Promise<T>): Promise<T> =>
      // Return the captured data even though the callback uses
      // its own (separately-built) repo; both share the same
      // `captureSink` closure so writes are observed.
      cb(captureRepo(initialRow, captureSink)),
  }) as unknown as IncidentStateRepository;

const runApplyTransition = async (
  initialRow: IncidentRow,
  verb: ActionVerb,
  nextState: IncidentState,
  extraEventPayload: Record<string, unknown> = {},
  assigneeUserId: string | null = null,
): Promise<Record<string, unknown>> => {
  const captureSink: { updateData: Record<string, unknown> | null } = { updateData: null };
  const repo = captureRepo(initialRow, captureSink);
  const result = makeSuccess(verb, nextState, extraEventPayload);
  await applyTransition(repo, {
    currentRow: initialRow,
    result,
    actorUserId: TECH_UUID,
    assigneeUserId,
  });
  // The capture sink is populated by the time the await resolves;
  // the `!` is safe because every code path that succeeds calls
  // `updateMany` at least once.
  return captureSink.updateData ?? {};
};

describe("Story 4.11 — applyTransition writer contract", () => {
  it("REOPEN: forces severity: 'critical' on the reopened row regardless of prior severity", async () => {
    const initialRow = baseRow({ state: "RESOLVED", severity: "warning", resolvedAt: new Date() });
    const updateData = await runApplyTransition(initialRow, "reopen", "OPEN", {
      reason: "Misclassified — device still failing",
    });
    expect(updateData["severity"]).toBe("critical");
    expect(updateData["state"]).toBe("OPEN");
  });

  it("REOPEN: still forces severity: 'critical' even when prior severity was already 'critical'", async () => {
    const initialRow = baseRow({ state: "RESOLVED", severity: "critical", resolvedAt: new Date() });
    const updateData = await runApplyTransition(initialRow, "reopen", "OPEN", {
      reason: "Reopened for retry",
    });
    expect(updateData["severity"]).toBe("critical");
  });

  it("ACK: does NOT touch severity — the column is OMITTED from the update payload", async () => {
    const initialRow = baseRow({ state: "OPEN", severity: "warning" });
    const updateData = await runApplyTransition(initialRow, "acknowledge", "ACKNOWLEDGED");
    expect(updateData).not.toHaveProperty("severity");
    expect(updateData["state"]).toBe("ACKNOWLEDGED");
  });

  it("ASSIGN: does NOT touch severity — the column is OMITTED from the update payload", async () => {
    const initialRow = baseRow({ state: "ACKNOWLEDGED", severity: "warning" });
    const updateData = await runApplyTransition(
      initialRow,
      "assign",
      "INSPECTING",
      { assigneeUserId: TECH_UUID },
      TECH_UUID,
    );
    expect(updateData).not.toHaveProperty("severity");
    expect(updateData["assigneeUserId"]).toBe(TECH_UUID);
    expect(updateData["state"]).toBe("INSPECTING");
  });

  it("SUBMIT_RESULT: does NOT touch severity — the column is OMITTED from the update payload", async () => {
    const initialRow = baseRow({
      state: "INSPECTING",
      severity: "warning",
      assigneeUserId: TECH_UUID,
    });
    const updateData = await runApplyTransition(
      initialRow,
      "submit_result",
      "SAFE",
      { outcome: "SAFE" },
      TECH_UUID,
    );
    expect(updateData).not.toHaveProperty("severity");
    expect(updateData["state"]).toBe("SAFE");
  });

  it("RESOLVE: does NOT touch severity — the column is OMITTED from the update payload", async () => {
    const initialRow = baseRow({
      state: "UNSAFE",
      severity: "warning",
      acknowledgedAt: new Date(),
    });
    const updateData = await runApplyTransition(initialRow, "resolve", "RESOLVED");
    expect(updateData).not.toHaveProperty("severity");
    expect(updateData["state"]).toBe("RESOLVED");
    // Resolved timestamp IS stamped on resolve.
    expect(updateData["resolvedAt"]).toBeDefined();
  });

  it("REOPEN: clears resolvedAt (the reopened row is in-flight, not historical)", async () => {
    const initialRow = baseRow({
      state: "RESOLVED",
      severity: "warning",
      resolvedAt: new Date("2026-08-27T02:00:00.000Z"),
    });
    const updateData = await runApplyTransition(initialRow, "reopen", "OPEN", {
      reason: "Reopened",
    });
    expect(updateData["resolvedAt"]).toBeNull();
  });
});

/**
 * Belt-and-suspenders: ensure the `IncidentSeveritySchema` accepts
 * the `severity` value the writer force-writes for reopen. If the
 * schema ever rejected `"critical"`, the writer's update payload
 * would be a runtime type-mismatch (the row's column type accepts
 * only the schema's enum values).
 */
describe("Story 4.11 — forced-critical severity value is schema-valid", () => {
  it("'critical' is a valid IncidentSeverity", () => {
    const parsed = IncidentSeveritySchema.safeParse("critical");
    expect(parsed.success).toBe(true);
  });
});
