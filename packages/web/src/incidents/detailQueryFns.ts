/**
 * TanStack Query `queryFn`s for the detail page (parent row +
 * timeline). Pure module (no React, no JSX). 403 → tagged RBAC
 * error; 404 → tagged not-found error; wire-shape mismatch
 * logs + throws generic Error.
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
