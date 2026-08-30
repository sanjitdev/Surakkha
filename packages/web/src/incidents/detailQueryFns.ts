/**
 * `detailQueryFns` — extract the two TanStack Query `queryFn`s
 * (incident row + timeline) from `<IncidentDetailPage />` so the
 * page-level function stays under the `complexity: 10` lint ceiling.
 *
 * Both functions classify HTTP status codes into tagged errors
 * (`IncidentDetailRbacDeniedError` / `IncidentDetailNotFoundError`)
 * so the page's `isError` branch can branch on the error class
 * without coupling the queryFn to the render path.
 *
 * Pure module (no React, no JSX). The two helpers are unit-
 * testable by passing a stub `apiFetch` and a known `id`.
 */
import {
  type IncidentEventPayload,
  IncidentEventPayloadSchema,
  type IncidentPayload,
  IncidentPayloadSchema,
} from "@surakkha/shared/incident";
import { z } from "zod";

import { apiFetch } from "../api/apiClient";

import { IncidentDetailNotFoundError } from "./IncidentDetailNotFoundError";
import { IncidentDetailRbacDeniedError } from "./IncidentDetailRbacDeniedError";

/** HTTP status code sentinels — RBAC denial + not-found. */
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const IncidentEventEnvelopeSchema = z.object({
  events: z.array(IncidentEventPayloadSchema),
});

export interface IncidentDetailEnvelope {
  readonly incident: IncidentPayload;
}

export interface IncidentTimeline {
  readonly events: readonly IncidentEventPayload[];
}

/**
 * Fetch the parent incident row.
 *
 *   403 → `IncidentDetailRbacDeniedError` (Tech ownership / role denied).
 *   404 → `IncidentDetailNotFoundError` (id is bogus or row deleted).
 *   5xx/other → generic `Error`.
 *   200 → parses the wire body through `IncidentPayloadSchema`.
 *
 * Wire-shape mismatch logs `console.error` (matching the
 * `incidents/active` precedent) and throws a generic `Error`.
 */
export const fetchIncidentDetail = async (id: string): Promise<IncidentDetailEnvelope> => {
  const res = await apiFetch(`/api/incidents/${id}`);
  if (res.status === HTTP_FORBIDDEN) {
    throw new IncidentDetailRbacDeniedError();
  }
  if (res.status === HTTP_NOT_FOUND) {
    throw new IncidentDetailNotFoundError();
  }
  if (!res.ok) {
    throw new Error(`/api/incidents/${id} failed: ${res.status}`);
  }
  const parsed = IncidentPayloadSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error("incidents/:id wire-shape mismatch", parsed.error);
    throw new Error("incidents/:id wire-shape mismatch");
  }
  return { incident: parsed.data };
};

/**
 * Fetch the audit timeline for the parent incident.
 *
 *   403 → `IncidentDetailRbacDeniedError` (Tech ownership denied).
 *   404 → `IncidentDetailNotFoundError` (parent row missing).
 *   5xx/other → generic `Error`.
 *   200 → parses the `{ events: [...] }` envelope.
 */
export const fetchIncidentTimeline = async (id: string): Promise<IncidentTimeline> => {
  const res = await apiFetch(`/api/incidents/${id}/events`);
  if (res.status === HTTP_FORBIDDEN) {
    throw new IncidentDetailRbacDeniedError();
  }
  if (res.status === HTTP_NOT_FOUND) {
    throw new IncidentDetailNotFoundError();
  }
  if (!res.ok) {
    throw new Error(`/api/incidents/${id}/events failed: ${res.status}`);
  }
  const parsed = IncidentEventEnvelopeSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error("incidents/:id/events wire-shape mismatch", parsed.error);
    throw new Error("incidents/:id/events wire-shape mismatch");
  }
  return { events: parsed.data.events };
};
