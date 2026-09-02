/**
 * `wire.ts` — Zod schemas for the wire shapes the incident surfaces
 * parse at fetch time.
 *
 * The canonical `IncidentPayloadSchema` lives in
 * `@surakkha/shared/incident`; the schemas here MUST stay
 * structurally equivalent to it (see `KanbanBoard.spec.tsx`'s
 * "structural equivalence" test). If a future change adds a field
 * to the canonical schema, these copies must move in lock-step or
 * the `safeParse` at the fetch site will start failing at runtime.
 */
import { z } from "zod";

export const IncidentPayloadWireSchema = z.object({
  id: z.string().uuid(),
  device_id: z.string().uuid(),
  severity: z.enum(["info", "warning", "critical"]),
  metric: z.string(),
  value: z.number(),
  opened_at: z.string().datetime({ offset: true }),
  state: z.enum([
    "OPEN",
    "ACKNOWLEDGED",
    "INSPECTING",
    "SAFE",
    "UNSAFE",
    "MONITORING",
    "RESOLVED",
    "REOPENED",
  ]),
  assignee_user_id: z.string().uuid().nullable(),
  acknowledged_at: z.string().datetime({ offset: true }).nullable(),
  resolved_at: z.string().datetime({ offset: true }).nullable(),
});

export const ActiveIncidentsEnvelopeSchema = z.object({
  incidents: z.array(IncidentPayloadWireSchema),
});
