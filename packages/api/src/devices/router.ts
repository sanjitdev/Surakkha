/**
 * `GET /api/devices` — Map roster.
 *
 * Wire shape:
 *   200 → { devices: ReadonlyArray<{
 *             id: string,
 *             name: string | null,
 *             lat: number | null,
 *             lng: number | null,
 *             last_reading_at: string | null  (ISO 8601)
 *           }> }
 *
 * The roster returns the device table joined to
 * `MAX(Reading.serverReceivedAt)` per device. Devices with no
 * reading yet surface `last_reading_at: null` (the map renders them
 * in the `offline` severity token). RBAC: `read Device` — every
 * authenticated role can read.
 *
 * Empty: `{ devices: [] }` — covers the "DB down → empty state"
 *   path (the dashboard's `MapRegion` falls back to "No devices" if
 *   this 500s).
 *
 * Sort order: `id ASC` — stable across refreshes so the map marker
 *   order never shuffles.
 */
import { type DevicesResponse, type DeviceSummary } from "@surakkha/shared/dashboard";
import express, { type Response, type Router } from "express";

import { ERROR_CODES } from "../errors.js";
import { HTTP_INTERNAL_ERROR, HTTP_OK } from "../httpStatus.js";
import { authorize } from "../middleware/authorize.js";

import type { AuditLogger } from "../audit.js";

export interface DevicesRosterDeps {
  readonly audit: AuditLogger;
  /**
   * Injectable data layer. Production uses Prisma's `device.findMany`
   * with a left-join to a `MAX(serverReceivedAt)` aggregate; tests
   * pass a stub that returns canned rows.
   */
  readonly listDevices: () => Promise<readonly DeviceSummary[]>;
}

/**
 * Build the `/api/devices` route. Mounted AFTER `authenticate` in
 * `packages/api/src/index.ts`.
 *
 * Lazy Prisma: this module never imports `@prisma/client`. The
 * production wiring injects a function that resolves the client
 * lazily. HTTP-only tests pass a stub so no DB is needed.
 */
export const buildDevicesRouter = (deps: DevicesRosterDeps): Router => {
  const router = express.Router();

  router.get(
    "/api/devices",
    authorize({ action: "read", resource: "Device" }, deps.audit),
    async (_req, res: Response) => {
      try {
        const devices = await deps.listDevices();
        const body: DevicesResponse = { devices };
        res.status(HTTP_OK).json(body);
      } catch (err) {
        // Surface a 500 so the dashboard's `useDashboardDevices`
        // marks the query `isError` and `MapRegion` falls back to
        // the "No devices" empty state (the map region renders its
        // empty state, KPI band + Live Readings table continue
        // rendering from the working readings cache).
        console.error("api/devices: prisma error", err);
        res.status(HTTP_INTERNAL_ERROR).json({ error: ERROR_CODES.INTERNAL_ERROR.value });
      }
    },
  );

  return router;
};
