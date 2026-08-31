/**
 * `MapView` — Story 2.7.
 *
 * Leaflet surface for the operator dashboard's map region. Renders
 * one `divIcon` marker per device at the seeded coordinates; each
 * marker's colour is the severity `fill` token driven by
 * `deviceMapSeverity()` (joins the device roster with the latest
 * reading cache, plus an offline-state flip when `last_reading_at`
 * lapsed beyond `OFFLINE_THRESHOLD_MS`).
 *
 * Hard contract:
 *   - Markers are Leaflet `divIcon` instances; no raster marker
 *     icons. Severity colour = `bg-severity-{sev}-value`. The 14px
 *     size and 2px white border are fixed.
 *   - Critical markers carry the 2000ms `animate-pin-pulse` halo
 *     from `motion.pin_pulse_ms`; the existing
 *     `prefers-reduced-motion` override in `index.css` already
 *     disables the halo — no new motion code.
 *   - The map subscribes to no socket of its own. The shared
 *     `useDashboardSocket` invalidates the readings cache on
 *     `reading:new`, which the map joins to devices; the markers
 *     re-evaluate severity from the joined cache.
 *   - Updating severity swaps the icon without unmounting the
 *     marker (Leaflet's `setIcon`); position updates use
 *     `setLatLng`. The popup re-renders from the cached reading.
 *   - The popup shows the device name, the breached metric + value
 *     (or "—" for healthy / never-read), a severity dot, and a link
 *     to `/devices/{device_id}` (a placeholder route until Story
 *     4.x lands — resolved per Ask-First).
 *
 * Lifecycle:
 *   - The map mounts once on first non-loading data and stays
 *     mounted through the `reading:new` invalidations.
 *   - The container's height is `h-[420px]` so layout doesn't
 *     shift when the map mounts.
 *
 * Empty / loading paths:
 *   - Devices loading → "Loading map…" overlay (no map mount).
 *   - Devices error (5xx) → parent `MapRegion` falls back to the
 *     static "No devices" empty state via `isError`.
 *   - Devices empty → parent `MapRegion` renders the static
 *     "No devices" copy.
 */
import {
  breachedMetric,
  deviceMapSeverity,
  type DeviceSummary,
  type LatestReadingPayload,
  type MapSeverity,
} from "@surakkha/shared/dashboard";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef } from "react";

import { SEVERITY_CLASS, SEVERITY_GLYPH } from "./severityTokens";

// Map fit constants. Lifted from the Epic 2 §UX default map
// dimensions — the map view sits inside the dashboard's left
// column at 420 px tall; the operators centre on Dhaka and zoom
// until every marker sits well inside the canvas.
//
// The container height is rendered as the literal `h-[420px]`
// in the JSX below — Tailwind's JIT scanner doesn't expand
// template-literal class strings (see `buildIconHtml` for the
// same caveat applied to pin sizing). `PIN_SIZE_PX` is still
// needed at runtime because Leaflet consumes it as a JS number
// via `iconSize: [PIN_SIZE_PX, PIN_SIZE_PX]`.
const PIN_SIZE_PX = 14;
const PIN_ANCHOR_OFFSET = 7;
const DHAKA_LAT = 23.78;
const DHAKA_LNG = 90.41;
const DEFAULT_ZOOM = 11;
// Coarser-unit thresholds for offline-pupup copy. Below 60 minutes
// we render `Nm ago`; from 1 hour to 24h we render `Nh ago`;
// beyond 24h we render `Nd ago`. Critique 2026-08-31 valley
// finding: a 10-day offline device was reading "1m ago" because
// `Math.max(1, …)` clamped the minute count without changing
// units — trust-eroding. The thresholds below are pinned so a
// future drift (e.g. switching back to minute-only) breaks the
// spec assertion rather than the operator's trust.
const MINUTES_PER_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const HOUR_THRESHOLD_MS = MINUTES_PER_HOUR * MINUTES_PER_MS;
const DAY_THRESHOLD_MS = HOURS_PER_DAY * HOUR_THRESHOLD_MS;

/**
 * Severity → Tailwind `fill` token lookup. Mirrors
 * `color.severity.{sev}.fill` from `tailwind.config.ts`. We use
 * the saturated `value` slot (the `fill` token collides with the
 * CSS `background-color: fill` shorthand at the Tailwind utility
 * layer; the `value` slot is the same literal `#16A34A` / etc.
 * and avoids the ambiguity). Story 2.8 extracts the lookup into
 * `severityTokens.ts` so the live-readings row uses the same
 * literals — see that file for the canonical reference.
 */
// SEVERITY_CLASS + SEVERITY_GLYPH now live in `./severityTokens.ts` (Story 2.8).

/**
 * Build the divIcon HTML — a 14px circle with the severity fill, a
 * 2px white border, the severity glyph, and an optional pulse class
 * for `critical`.
 */
const buildIconHtml = (severity: MapSeverity): string => {
  const fill = SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.offline;
  const glyph = SEVERITY_GLYPH[severity] ?? "";
  const pulse = severity === "critical" ? " animate-pin-pulse" : "";
  // `rounded-full` for the circle; `border-2 border-white` for the
  // 2px ring. White always sits under the severity fill so dark
  // modes don't invert the ring.
  //
  // Tailwind's JIT can't expand `h-[${PIN_SIZE_PX}px] w-[${PIN_SIZE_PX}px]`
  // (template-literal interpolation defeats static class scanning),
  // so the literal `"h-3.5 w-3.5"` (= 14px at 4px/step) is written
  // directly. The corresponding JS-side `iconSize: [PIN_SIZE_PX, ...]`
  // below still uses the named constant — only the className needs
  // the literal because Tailwind's scanner doesn't run on runtime
  // template strings.
  return `<span class="leaflet-pin leaflet-pin-${severity} inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white${pulse} ${fill} text-[8px] font-bold leading-none text-white">${glyph}</span>`;
};

/**
 * Format the popup's offline-state body line. Coarser-unit
 * thresholds (see constants above): days → hours → minutes.
 * Returns `null` for malformed `last_reading_at` timestamps so
 * the caller can fall back to the bare "Offline" line.
 */
const formatOfflineAgeLabel = (lastReadingAt: string): string | null => {
  const lastSeenMs = new Date(lastReadingAt).getTime();
  if (!Number.isFinite(lastSeenMs)) return null;
  const elapsedMs = Date.now() - lastSeenMs;
  if (elapsedMs >= DAY_THRESHOLD_MS) {
    return `${Math.round(elapsedMs / DAY_THRESHOLD_MS)}d ago`;
  }
  if (elapsedMs >= HOUR_THRESHOLD_MS) {
    return `${Math.round(elapsedMs / HOUR_THRESHOLD_MS)}h ago`;
  }
  const minutes = Math.max(1, Math.round(elapsedMs / MINUTES_PER_MS));
  return `${minutes}m ago`;
};

/**
 * Format the popup HTML — device name, breached metric + value,
 * severity dot, link to `/devices/{device_id}`. The popup is
 * dismissible with Escape (Leaflet default).
 */
const buildPopupHtml = (args: {
  readonly device: DeviceSummary;
  readonly severity: MapSeverity;
  readonly reading: LatestReadingPayload | undefined;
}): string => {
  const { device, severity, reading } = args;
  const fill = SEVERITY_CLASS[severity];
  const breach = reading === undefined ? null : breachedMetric(reading);
  let bodyLine: string;
  if (severity === "offline") {
    if (device.last_reading_at === null) {
      bodyLine = `<p class="text-xs text-neutral-secondary">No reading yet</p>`;
    } else {
      const ageLabel = formatOfflineAgeLabel(device.last_reading_at);
      bodyLine =
        ageLabel === null
          ? `<p class="text-xs text-neutral-secondary">Offline</p>`
          : `<p class="text-xs text-neutral-secondary">Offline \u2014 last seen ${ageLabel}</p>`;
    }
  } else if (breach === null) {
    bodyLine = `<p class="text-xs text-neutral-secondary">All metrics in range</p>`;
  } else {
    const value = Number.isFinite(breach.value) ? String(breach.value) : "\u2014";
    bodyLine = `<p class="text-xs text-neutral-body"><span class="font-mono">${breach.key}</span> = <span class="font-mono">${value}</span></p>`;
  }
  return [
    `<div class="space-y-1 font-sans">`,
    `<div class="flex items-center gap-2">`,
    `<span class="inline-block h-2 w-2 rounded-full ${fill}"></span>`,
    `<p class="text-sm font-semibold text-neutral-body">${escapeHtml(device.name ?? "Unnamed device")}</p>`,
    `</div>`,
    bodyLine,
    `<a href="/devices/${device.id}" data-testid="dashboard-map-popup-link-${device.id}" class="block text-xs text-primary underline">Open device details</a>`,
    `</div>`,
  ].join("");
};

/**
 * Escape user-controlled device names before they land in the
 * popup HTML (innerHTML sink). Reuses the precise boundary that
 * React escapes for — we keep an explicit copy because Leaflet
 * owns the popup rendering, not React.
 */
const escapeHtml = (raw: string): string =>
  raw.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });

/**
 * Sum the readings keyed by `device_id` into a Map. Pure: takes
 * the readings array and returns a lookup. The newest reading wins
 * when duplicates slip past `useDashboardReadings` (defensive — the
 * cache already orders `server_received_at DESC`).
 */
const indexReadingsByDevice = (
  readings: readonly LatestReadingPayload[],
): Map<string, LatestReadingPayload> => {
  const map = new Map<string, LatestReadingPayload>();
  for (const r of readings) {
    if (!map.has(r.device_id)) map.set(r.device_id, r);
  }
  return map;
};

/**
 * Build a render-tick string that changes when any device's
 * severity changes. The markers effect depends on this so a
 * breach-flip swaps the icon even if the device list and readings
 * references stay referentially stable. Pure.
 */
const buildRenderTick = (
  devices: readonly DeviceSummary[],
  readingsById: Map<string, LatestReadingPayload>,
): string => {
  let tick = "";
  for (const d of devices) {
    const reading = readingsById.get(d.id);
    const sev = deviceMapSeverity(d, reading, Date.now());
    tick += `${d.id}:${sev}|`;
  }
  return tick;
};

interface MapViewProps {
  readonly devices: readonly DeviceSummary[];
  readonly readings: readonly LatestReadingPayload[];
}

/**
 * Centre on Bangladesh. Dhaka is ~23.81N, 90.41E; the camera fits
 * the six seeded markers in view at zoom 11.
 */
const DEFAULT_CENTER: [number, number] = [DHAKA_LAT, DHAKA_LNG];

export const MapView = ({ devices, readings }: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const readingsById = useMemo(() => indexReadingsByDevice(readings), [readings]);
  // Bump-tick so the effect below treats "severity changed" as a
  // distinct render from "map first mounted". Extracted to a named
  // helper so the .map callback isn't an inline function (lint).
  const renderTick = useMemo(() => buildRenderTick(devices, readingsById), [devices, readingsById]);

  /**
   * Initial map mount. Runs once per MapView lifecycle (StrictMode
   * double-mount handled by the `if (mapRef.current === null)`
   * guard). Subsequent renders update marker severity without
   * touching the map handle.
   */
  useEffect(() => {
    if (containerRef.current === null) return undefined;
    if (mapRef.current !== null) return undefined;

    // `L.map` is Leaflet's static factory, not Array#map — the
    // `unicorn/no-array-callback-reference` rule can't tell.
    // eslint-disable-next-line unicorn/no-array-callback-reference
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
      // Disable every animation-driven gesture that could draw
      // operator attention away from the markers. Panning and
      // zooming stay enabled so the operator can navigate.
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
    });
    // `markersRef.current` is captured here for the cleanup to
    // avoid the exhaustive-deps lint warning; the ref handle is
    // mutated below by the markers effect.
    const markers = markersRef.current;
    mapRef.current = map;

    // CartoDB Positron — light, neutral basemap; the severity
    // fill colours sit cleanly on top without competing hue. Open
    // OSM tiles via the public CDN is fine for v1; production may
    // swap to a self-hosted tileserver.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
  }, []);

  /**
   * Markers / severity lifecycle. Recomputes the marker set on every
   * `renderTick` change; uses Leaflet's `addTo` + `setIcon` so
   * markers are never React-stateful. New devices add a marker;
   * removed devices drop out (the roster is stable so this branch
   * rarely fires in production).
   */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;

    const seenIds = new Set<string>();
    const now = Date.now();
    for (const device of devices) {
      seenIds.add(device.id);
      if (device.lat === null || device.lng === null) continue;
      const reading = readingsById.get(device.id);
      const severity = deviceMapSeverity(device, reading, now);

      let marker = markersRef.current.get(device.id);
      if (marker === undefined) {
        const icon = L.divIcon({
          className: `leaflet-pin-${severity}`,
          html: buildIconHtml(severity),
          iconSize: [PIN_SIZE_PX, PIN_SIZE_PX],
          iconAnchor: [PIN_ANCHOR_OFFSET, PIN_ANCHOR_OFFSET],
        });
        marker = L.marker([device.lat, device.lng], { icon }).addTo(map);
        marker.bindPopup(buildPopupHtml({ device, severity, reading }));
        markersRef.current.set(device.id, marker);
      } else {
        marker.setLatLng([device.lat, device.lng]);
        const newIcon = L.divIcon({
          className: `leaflet-pin-${severity}`,
          html: buildIconHtml(severity),
          iconSize: [PIN_SIZE_PX, PIN_SIZE_PX],
          iconAnchor: [PIN_ANCHOR_OFFSET, PIN_ANCHOR_OFFSET],
        });
        marker.setIcon(newIcon);
        marker.setPopupContent(buildPopupHtml({ device, severity, reading }));
      }
    }
    // Drop markers whose device vanished from the roster. Stable
    // in v1 but kept defensive for Epic 3 device churn.
    for (const [id, marker] of markersRef.current.entries()) {
      if (!seenIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [devices, readingsById, renderTick]);

  return (
    <div
      ref={containerRef}
      data-testid="dashboard-map-view"
      // `h-[420px]` is inlined as a literal — same JIT caveat as
      // `buildIconHtml`: Tailwind's scanner only sees static strings.
      className="h-[420px] w-full overflow-hidden rounded-input border border-neutral-border"
      aria-label="Devices map"
      role="region"
    />
  );
};
