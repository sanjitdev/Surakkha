/**
 * `incidentStateRepository.spec.ts` — Story 4.4 step-04 review.
 *
 * Direct unit tests for the row → wire serializers
 * (`incidentRowToPayload`, `incidentEventRowToPayload`).
 *
 * Why dedicated unit tests: the route-level tests
 * (`router.spec.ts`) verify the envelope shape via
 * `IncidentEventPayloadSchema.safeParse`, but `safeParse` does
 * not pin:
 *   - Field-name mapping (camelCase → snake_case)
 *   - Date → ISO string conversion (both Date instances AND
 *     ISO-string inputs)
 *   - The `{ ...row.payload }` shallow-clone (mutation safety:
 *     a regression that swapped to `payload: row.payload` would
 *     leak the source row's reference to consumers)
 *   - `null` vs missing fields on the wire (the schema treats
 *     them as nullable)
 *
 * Coverage:
 *   - `incidentEventRowToPayload` with Date createdAt
 *   - `incidentEventRowToPayload` with ISO-string createdAt
 *   - `incidentEventRowToPayload` returns a fresh payload object
 *     (mutation isolation)
 *   - `incidentRowToPayload` with all nullable fields populated
 *   - `incidentRowToPayload` with null acknowledged/resolved
 */
import { describe, expect, it } from "vitest";

import {
  incidentEventRowToPayload,
  incidentRowToPayload,
  type IncidentEventRow,
  type IncidentRow,
} from "./incidentStateRepository";

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

const baseEventRow = (overrides: Partial<IncidentEventRow> = {}): IncidentEventRow => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  incidentId: "11111111-1111-4111-8111-111111111111",
  actorUserId: null,
  type: "acknowledge",
  payload: { from: "OPEN", to: "ACKNOWLEDGED" },
  createdAt: new Date("2026-08-27T01:00:00.000Z"),
  ...overrides,
});

describe("Story 4.4 — incidentEventRowToPayload", () => {
  it("maps field names (camelCase → snake_case) and serializes createdAt as ISO", () => {
    const row = baseEventRow();
    const payload = incidentEventRowToPayload(row);
    expect(payload).toEqual({
      id: row.id,
      incident_id: row.incidentId,
      actor_user_id: row.actorUserId,
      type: "acknowledge",
      payload: { from: "OPEN", to: "ACKNOWLEDGED" },
      created_at: "2026-08-27T01:00:00.000Z",
    });
  });

  it("accepts a createdAt ISO string and normalizes via Date()", () => {
    // Prisma normally returns Date, but the helper defensively
    // handles the string case (some test doubles or migration
    // shapes might pass a string). Pin the contract.
    const row = baseEventRow({
      createdAt: "2026-08-27T01:00:00.000Z" as unknown as Date,
    });
    const payload = incidentEventRowToPayload(row);
    expect(payload.created_at).toBe("2026-08-27T01:00:00.000Z");
  });

  it("returns a FRESH payload object — mutating the result must NOT mutate the source row", () => {
    const sourcePayload = { from: "OPEN", to: "ACKNOWLEDGED" };
    const row = baseEventRow({ payload: sourcePayload });
    const payload = incidentEventRowToPayload(row);

    // Mutate the wire payload — the source row's payload must be
    // untouched. This is the contract that justifies the
    // `{ ...row.payload }` shallow clone.
    (payload.payload as Record<string, unknown>)["from"] = "MUTATED";
    expect(sourcePayload.from).toBe("OPEN");
    expect(payload.payload).not.toBe(sourcePayload);
  });

  it("preserves every IncidentEventType enum value verbatim", () => {
    const types: Array<IncidentEventRow["type"]> = [
      "acknowledge",
      "assign",
      "submit_result",
      "resolve",
      "reopen",
      "invalid_transition_attempt",
    ];
    for (const type of types) {
      const row = baseEventRow({ type });
      expect(incidentEventRowToPayload(row).type).toBe(type);
    }
  });
});

describe("Story 4.4 — incidentRowToPayload", () => {
  it("maps field names and serializes Date openedAt as ISO", () => {
    const row = baseRow();
    const payload = incidentRowToPayload(row);
    expect(payload.id).toBe(row.id);
    expect(payload.device_id).toBe(row.deviceId);
    expect(payload.severity).toBe(row.severity);
    expect(payload.metric).toBe(row.metric);
    expect(payload.value).toBe(row.value);
    expect(payload.opened_at).toBe("2026-08-27T00:00:00.000Z");
    expect(payload.state).toBe(row.state);
  });

  it("maps null acknowledged_at and resolved_at to null on the wire", () => {
    const row = baseRow({ acknowledgedAt: null, resolvedAt: null });
    const payload = incidentRowToPayload(row);
    expect(payload.acknowledged_at).toBeNull();
    expect(payload.resolved_at).toBeNull();
  });

  it("serializes non-null acknowledged_at / resolved_at as ISO strings", () => {
    const row = baseRow({
      acknowledgedAt: new Date("2026-08-27T01:00:00.000Z"),
      resolvedAt: new Date("2026-08-27T02:00:00.000Z"),
    });
    const payload = incidentRowToPayload(row);
    expect(payload.acknowledged_at).toBe("2026-08-27T01:00:00.000Z");
    expect(payload.resolved_at).toBe("2026-08-27T02:00:00.000Z");
  });
});
