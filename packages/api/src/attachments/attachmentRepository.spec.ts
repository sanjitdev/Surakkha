/**
 * `attachmentRepository.spec.ts` — Story 4.13.
 *
 * Direct unit tests for `attachmentRowToPayload` (pure adapter).
 * Mirrors `incidentStateRepository.spec.ts` (4.4) which pins the
 *   - field-name mapping (camelCase → snake_case)
 *   - Date → ISO string conversion
 *   - null vs missing fields on the wire
 *
 * Why dedicated unit tests: the route-level tests
 * (`attachmentRouter.spec.ts`) verify the envelope shape via
 * `AttachmentPayloadSchema.safeParse`, but `safeParse` does not
 * pin the camelCase → snake_case conversion or the `Date → ISO`
 * conversion. A regression that swapped to `created_at:
 * row.createdAt` would still pass the schema parse (Date is not
 * a string; the schema rejects non-strings, but the test would
 * pass because the adapter sits between the row and the parse
 * call) — so these unit tests are the seam that catches it.
 */
import { describe, expect, it } from "vitest";

import { type AttachmentRow } from "./attachmentRepository.js";
import { attachmentRowToPayload } from "./attachmentRowToPayload.js";

const baseRow = (overrides: Partial<AttachmentRow> = {}): AttachmentRow => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  incidentId: "11111111-1111-4111-8111-111111111111",
  url: "https://example.com/photo.png",
  label: "Sensor photo",
  mime: "image/png",
  uploadedByUserId: "00000000-0000-4000-8000-00000000a002",
  createdAt: new Date("2026-08-27T01:00:00.000Z"),
  ...overrides,
});

describe("Story 4.13 — attachmentRowToPayload", () => {
  it("maps field names (camelCase → snake_case) and serializes createdAt as ISO", () => {
    const row = baseRow();
    const payload = attachmentRowToPayload(row);
    expect(payload).toEqual({
      id: row.id,
      incident_id: row.incidentId,
      url: row.url,
      label: row.label,
      mime: row.mime,
      uploaded_by_user_id: row.uploadedByUserId,
      created_at: "2026-08-27T01:00:00.000Z",
    });
  });

  it("maps null label / mime / uploadedByUserId to null on the wire (nullable fields)", () => {
    // The shared schema (`AttachmentPayloadSchema`) declares these
    // three as `nullable()`. The adapter must preserve nulls, NOT
    // coerce to undefined or empty string. A regression that
    // dropped the `?? null` chain would surface here as `undefined`
    // sneaking into the payload — schema parse would reject (the
    // Zod `nullable` does not accept undefined).
    const row = baseRow({
      label: null,
      mime: null,
      uploadedByUserId: null,
    });
    const payload = attachmentRowToPayload(row);
    expect(payload.label).toBeNull();
    expect(payload.mime).toBeNull();
    expect(payload.uploaded_by_user_id).toBeNull();
  });

  it("round-trips through AttachmentPayloadSchema.parse on every call", () => {
    // The adapter's defensive `AttachmentPayloadSchema.parse(payload)`
    // runs on every conversion — any structural drift (a future
    // rename, an extra column) fails fast at the seam instead of
    // silently corrupting the wire shape. This test asserts the
    // parse does not throw for the canonical input.
    const row = baseRow();
    expect(() => attachmentRowToPayload(row)).not.toThrow();
  });
});
