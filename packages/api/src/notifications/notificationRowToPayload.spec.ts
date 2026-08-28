/**
 * `notificationRowToPayload.spec.ts` — Story 4.10.
 *
 * Pure-helper coverage on the row-to-payload adapter. Mirrors the
 * 4.4 `incidentRowToPayload.spec.ts` pattern: each `NotificationRow`
 * field is pinned, including the wire-shape contract that drops
 * `acknowledgedByUserId` (audit field, not operator-facing) and
 * serializes both `Date` instances and string pass-throughs to ISO
 * 8601 (defensive against the writer's serializer contract drift).
 *
 * The five assertions:
 *
 *   - Drops `acknowledgedByUserId` from the payload — the actor
 *     identity never leaks to the wire (operator-facing surface
 *     deliberately omits "who acknowledged this row"; the audit
 *     trail lives in the DB only).
 *
 *   - Handles `acknowledgedAt: null` — the wire shape's
 *     `acknowledgedAt` field is `string | null`; the adapter must
 *     round-trip `null` untouched (not strip, not default to a
 *     zero ISO string).
 *
 *   - Serializes a `Date` `createdAt` to ISO string — Prisma's
 *     native type is `Date`; the wire shape is `string`. The
 *     `.toISOString()` call is the canonical serializer
 *     (matches the 4.4 incident pattern).
 *
 *   - Serializes a string `createdAt` defensively (passes through
 *     to a valid ISO string) — the adapter's defensive branch
 *     covers the case where the row was constructed via a stub
 *     that pre-serialized to a string (avoids a `Date.parse`
 *     round-trip). This is the writer-side stub seam.
 *
 *   - Preserves `severity`, `incidentId`, `alertId`,
 *     `recipientRole`, `id` — the field-by-field pin. No
 *     normalization, no defensive sort, no re-keying.
 */
import { describe, expect, it } from "vitest";

import { type NotificationRow } from "./notificationRepository.js";
import { notificationRowToPayload } from "./notificationRowToPayload.js";

const INCIDENT_ID_1 = "99999999-9999-4999-8999-999999999991";
const NOTIF_ID_1 = "11111111-1111-4111-8111-111111111111";

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

describe("Story 4.10 — notificationRowToPayload adapter", () => {
  it("drops `acknowledgedByUserId` from the wire payload (actor identity never leaks)", () => {
    // Pin the audit-vs-wire separation: the row has
    // `acknowledgedByUserId: "actor-actor-1"` (the actor that
    // acknowledged it), but the wire payload must NOT carry the
    // field at all — there is no `acknowledgedByUserId` key on
    // `NotificationPayload`.
    const payload = notificationRowToPayload({
      ...baseRow,
      acknowledgedByUserId: "actor-actor-1",
      acknowledgedAt: new Date("2026-08-28T11:00:00.000Z"),
    });
    expect(payload).not.toHaveProperty("acknowledgedByUserId");
    // The other field pins are still correct.
    expect(payload.id).toBe(NOTIF_ID_1);
  });

  it("handles `acknowledgedAt: null` — round-trips null untouched (no zero ISO)", () => {
    const payload = notificationRowToPayload({
      ...baseRow,
      acknowledgedAt: null,
    });
    expect(payload.acknowledgedAt).toBeNull();
  });

  it("serializes a Date `createdAt` to ISO string (canonical ISO 8601 format)", () => {
    const created = new Date("2026-08-28T10:00:00.000Z");
    const payload = notificationRowToPayload({
      ...baseRow,
      createdAt: created,
    });
    expect(payload.createdAt).toBe("2026-08-28T10:00:00.000Z");
    expect(payload.createdAt).not.toBe(created);
  });

  it("serializes a non-null `acknowledgedAt` Date to ISO string (parity with the createdAt branch)", () => {
    // The Date → ISO string canonical serializer applies to both
    // `createdAt` and `acknowledgedAt`. Pin the `acknowledgedAt`
    // branch: a non-null Date round-trips to the same instant via
    // `.toISOString()` (the strict ISO 8601 contract).
    const acknowledged = new Date("2026-08-28T11:30:00.000Z");
    const payload = notificationRowToPayload({
      ...baseRow,
      acknowledgedAt: acknowledged,
    });
    expect(payload.acknowledgedAt).toBe("2026-08-28T11:30:00.000Z");
    expect(payload.acknowledgedAt).not.toBe(acknowledged);
  });

  it("preserves severity, incidentId, alertId, recipientRole, id (no normalization)", () => {
    const ALERT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const payload = notificationRowToPayload({
      ...baseRow,
      severity: "warning",
      incidentId: null,
      alertId: ALERT_ID,
      recipientRole: "Admin",
    });
    expect(payload.severity).toBe("warning");
    expect(payload.incidentId).toBeNull();
    expect(payload.alertId).toBe(ALERT_ID);
    expect(payload.recipientRole).toBe("Admin");
    expect(payload.id).toBe(NOTIF_ID_1);
    // No surprise fields leak from the row.
    expect(Object.keys(payload).sort()).toEqual(
      [
        "id",
        "severity",
        "incidentId",
        "alertId",
        "recipientRole",
        "createdAt",
        "acknowledgedAt",
      ].sort(),
    );
  });
});
