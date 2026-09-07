/**
 * `resolveSensorsSeverity` — pure helper that joins a device roster
 * row with the latest-reading cache to resolve a `MapSeverity` for
 * the sensors table. Mirrors `deviceMapSeverity`
 * (`@surakkha/shared/dashboard`) but accepts a `Map<deviceId,
 * LatestReadingPayload>` instead of a single reading so the page
 * can do an O(1) lookup per row.
 *
 * Falls back to `"offline"` when:
 *   - `last_reading_at` is null OR older than `OFFLINE_THRESHOLD_MS`,
 *   - the readings cache has no entry for the device.
 */
import {
  type DeviceSummary,
  isOffline,
  type LatestReadingPayload,
  type MapSeverity,
  placeholderSeverity,
} from "@surakkha/shared/dashboard";

export const resolveSensorsSeverity = (
  device: Pick<DeviceSummary, "id" | "last_reading_at">,
  latestByDevice: ReadonlyMap<string, LatestReadingPayload>,
  now: number,
): MapSeverity => {
  if (isOffline(device, now)) return "offline";
  const latest = latestByDevice.get(device.id);
  if (latest === undefined) return "offline";
  return placeholderSeverity(latest);
};