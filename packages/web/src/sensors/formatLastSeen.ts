/**
 * `formatLastSeen` — render a "last reading" timestamp in the
 * seconds → minutes → hours → days ladder the sensors table needs.
 * Devices can go offline for days, so this is wider than
 * `dashboard/ageFormat.ts`'s narrow "just now / Xs / Xm" ceiling.
 *
 * Returns `"—"` when the timestamp is missing or unparseable so
 * the row reads as "intentionally empty" rather than "missing".
 * `now` is injected so callers (and the spec) control the clock.
 *
 * Mirrors `MapView.tsx`'s private `formatOfflineAgeLabel` ladder;
 * not promoted into `dashboard/ageFormat.ts` to keep this story
 * scoped to the sensors page. Future work can fold them together.
 */
const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const HOUR_THRESHOLD_MS = MINUTES_PER_HOUR * MINUTES_PER_MS;
const DAY_THRESHOLD_MS = HOURS_PER_DAY * HOUR_THRESHOLD_MS;

export const formatLastSeen = (
  iso: string | null,
  now: number,
): string => {
  if (iso === null) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const elapsedMs = Math.max(0, now - ts);
  if (elapsedMs >= DAY_THRESHOLD_MS) {
    return `${Math.round(elapsedMs / DAY_THRESHOLD_MS)}d ago`;
  }
  if (elapsedMs >= HOUR_THRESHOLD_MS) {
    return `${Math.round(elapsedMs / HOUR_THRESHOLD_MS)}h ago`;
  }
  if (elapsedMs >= MINUTES_PER_MS) {
    return `${Math.round(elapsedMs / MINUTES_PER_MS)}m ago`;
  }
  const seconds = Math.max(1, Math.round(elapsedMs / MS_PER_SECOND));
  return `${seconds}s ago`;
};

/** Short-prefix helper for the UUID `id` column. */
const DEVICE_ID_SHORT_PREFIX_LENGTH = 8;
export const formatDeviceIdShort = (id: string): string =>
  id.slice(0, DEVICE_ID_SHORT_PREFIX_LENGTH);

/** "lat, lng" to 5 decimal places; `"—"` when either is null. */
const LAT_LNG_DIGITS = 5;
export const formatLocation = (
  lat: number | null,
  lng: number | null,
): string => {
  if (lat === null || lng === null) return "—";
  return `${lat.toFixed(LAT_LNG_DIGITS)}, ${lng.toFixed(LAT_LNG_DIGITS)}`;
};