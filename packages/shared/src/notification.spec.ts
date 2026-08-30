/**
 * `notification.spec.ts` — Story 4.10 + Story 5.1.
 *
 * Wire-schema regression coverage for the notification surface.
 * The shared module is the canonical source for the operator-facing
 * bell (4.10) and the admin-facing list (5.1); test coverage lives
 * in shared (no api / web imports) so a schema drift fails CI at
 * the unit boundary.
 *
 * Story 5.1 additions:
 *
 *   - `AdminNotificationPayloadSchema` parses a row fixture.
 *   - `AdminNotificationPayloadSchema` rejects missing
 *     `acknowledgedByUserId` (admin surface MUST leak the field;
 *     a regression that strips it breaks the schema-parse contract).
 *   - `AdminNotificationListEnvelopeSchema` parses an envelope
 *     fixture.
 */
import { describe, expect, it } from "vitest";

import {
  AdminNotificationListEnvelopeSchema,
  AdminNotificationPayloadSchema,
  NotificationListEnvelopeSchema,
  NotificationPayloadSchema,
  NotificationSeveritySchema,
} from "./notification.js";

const STRONG_UUID = "00000000-0000-4000-8000-000000000001";

const baseAdminRow = {
  id: STRONG_UUID,
  severity: "critical" as const,
  incidentId: STRONG_UUID,
  alertId: null,
  recipientRole: "Operator" as const,
  createdAt: "2026-08-28T11:00:00.000Z",
  acknowledgedAt: "2026-08-28T11:30:00.000Z",
  acknowledgedByUserId: STRONG_UUID,
};

const baseOperatorRow = {
  id: STRONG_UUID,
  severity: "critical" as const,
  incidentId: STRONG_UUID,
  alertId: null,
  recipientRole: "Operator" as const,
  createdAt: "2026-08-28T11:00:00.000Z",
  acknowledgedAt: null,
};

describe("Story 4.10 — NotificationSeveritySchema", () => {
  it("accepts every documented severity", () => {
    expect(NotificationSeveritySchema.parse("info")).toBe("info");
    expect(NotificationSeveritySchema.parse("warning")).toBe("warning");
    expect(NotificationSeveritySchema.parse("critical")).toBe("critical");
  });
  it("rejects unknown severity values", () => {
    expect(() => NotificationSeveritySchema.parse("fatal")).toThrow();
  });
});

describe("Story 4.10 — NotificationPayloadSchema", () => {
  it("parses a row fixture", () => {
    expect(() => NotificationPayloadSchema.parse(baseOperatorRow)).not.toThrow();
  });
  it("rejects missing required fields", () => {
    const { severity: _omit, ...rest } = baseOperatorRow;
    expect(() => NotificationPayloadSchema.parse(rest)).toThrow();
  });
});

describe("Story 4.10 — NotificationListEnvelopeSchema", () => {
  it("parses an empty envelope", () => {
    expect(NotificationListEnvelopeSchema.parse({ notifications: [] })).toEqual({
      notifications: [],
    });
  });
  it("parses an envelope with a single row", () => {
    expect(NotificationListEnvelopeSchema.parse({ notifications: [baseOperatorRow] })).toEqual({
      notifications: [baseOperatorRow],
    });
  });
});

describe("Story 5.1 — AdminNotificationPayloadSchema", () => {
  it("parses a row fixture with acknowledgedByUserId populated", () => {
    expect(() => AdminNotificationPayloadSchema.parse(baseAdminRow)).not.toThrow();
  });
  it("parses a row fixture with acknowledgedByUserId null", () => {
    const { acknowledgedByUserId: _omit, ...rest } = baseAdminRow;
    expect(() =>
      AdminNotificationPayloadSchema.parse({ ...rest, acknowledgedByUserId: null }),
    ).not.toThrow();
  });
  it("rejects a row missing acknowledgedByUserId (admin surface MUST leak the field)", () => {
    const { acknowledgedByUserId: _omit, ...rest } = baseAdminRow;
    expect(() => AdminNotificationPayloadSchema.parse(rest)).toThrow();
  });
  it("rejects a non-UUID acknowledgedByUserId", () => {
    expect(() =>
      AdminNotificationPayloadSchema.parse({ ...baseAdminRow, acknowledgedByUserId: "not-a-uuid" }),
    ).toThrow();
  });
  it("rejects unknown severity", () => {
    expect(() =>
      AdminNotificationPayloadSchema.parse({ ...baseAdminRow, severity: "fatal" }),
    ).toThrow();
  });
});

describe("Story 5.1 — AdminNotificationListEnvelopeSchema", () => {
  it("parses an empty envelope", () => {
    expect(AdminNotificationListEnvelopeSchema.parse({ notifications: [] })).toEqual({
      notifications: [],
    });
  });
  it("parses an envelope with a single admin row", () => {
    expect(AdminNotificationListEnvelopeSchema.parse({ notifications: [baseAdminRow] })).toEqual({
      notifications: [baseAdminRow],
    });
  });
  it("rejects a row with acknowledgedByUserId missing from the payload", () => {
    const { acknowledgedByUserId: _omit, ...rest } = baseAdminRow;
    expect(() => AdminNotificationListEnvelopeSchema.parse({ notifications: [rest] })).toThrow();
  });
});
