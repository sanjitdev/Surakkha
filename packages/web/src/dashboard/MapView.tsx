/**
 * `MapView` — Leaflet surface for the dashboard's map region. One
 * `divIcon` marker per device; severity colour driven by joining the
 * device roster with the latest-reading cache. No socket of its own
 * — the shared `useDashboardSocket` invalidates the readings cache
 * on `reading:new` and the markers re-evaluate severity from the
 * joined cache.
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

// `h-3.5 w-3.5` (= 14px) and `h-[420px]` are LITERAL class strings.
// Tailwind's JIT content scanner matches complete literals only —
// template-literal interpolation (e.g. `h-[${PIN_SIZE_PX}px]`) is
// invisible to the scanner. `PIN_SIZE_PX` is still used at runtime
// via Leaflet's `iconSize: [PIN_SIZE_PX, ...]`.
const PIN_SIZE_PX = 14;
const PIN_ANCHOR_OFFSET = 7;
const DHAKA_LAT = 23.78;
const DHAKA_LNG = 90.41;
const DEFAULT_ZOOM = 11;
const MINUTES_PER_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const HOUR_THRESHOLD_MS = MINUTES_PER_HOUR * MINUTES_PER_MS;
const DAY_THRESHOLD_MS = HOURS_PER_DAY * HOUR_THRESHOLD_MS;
const DEFAULT_CENTER: [number, number] = [DHAKA_LAT, DHAKA_LNG];

/** Format the popup's offline-state body line in days → hours → minutes. */
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

/** Build the popup HTML. innerHTML sink — escape user input via `escapeHtml`. */
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

/** Escape user-controlled device names before they land in the popup HTML. */
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

/** Build the divIcon HTML — 14px circle, severity fill, 2px white ring, optional pulse. */
const buildIconHtml = (severity: MapSeverity): string => {
  const fill = SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.offline;
  const glyph = SEVERITY_GLYPH[severity] ?? "";
  const pulse = severity === "critical" ? " animate-pin-pulse" : "";
  return `<span class="leaflet-pin leaflet-pin-${severity} inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white${pulse} ${fill} text-[8px] font-bold leading-none text-white">${glyph}</span>`;
};

/** Index readings by device_id for O(1) lookup in the markers effect. */
const indexReadingsByDevice = (
  readings: readonly LatestReadingPayload[],
): Map<string, LatestReadingPayload> => {
  const map = new Map<string, LatestReadingPayload>();
  for (const r of readings) {
    if (!map.has(r.device_id)) map.set(r.device_id, r);
  }
  return map;
};

/** Render-tick string: changes whenever any device's severity flips. */
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

export const MapView = ({ devices, readings }: MapViewProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const readingsById = useMemo(() => indexReadingsByDevice(readings), [readings]);
  const renderTick = useMemo(() => buildRenderTick(devices, readingsById), [devices, readingsById]);

  useEffect(() => {
    if (containerRef.current === null) return undefined;
    if (mapRef.current !== null) return undefined;

    // `L.map` is Leaflet's static factory, not Array#map.
    // eslint-disable-next-line unicorn/no-array-callback-reference
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
    });
    const markers = markersRef.current;
    mapRef.current = map;

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
      const icon = L.divIcon({
        className: `leaflet-pin-${severity}`,
        html: buildIconHtml(severity),
        iconSize: [PIN_SIZE_PX, PIN_SIZE_PX],
        iconAnchor: [PIN_ANCHOR_OFFSET, PIN_ANCHOR_OFFSET],
      });
      if (marker === undefined) {
        marker = L.marker([device.lat, device.lng], { icon }).addTo(map);
        marker.bindPopup(buildPopupHtml({ device, severity, reading }));
        markersRef.current.set(device.id, marker);
      } else {
        marker.setLatLng([device.lat, device.lng]);
        marker.setIcon(icon);
        marker.setPopupContent(buildPopupHtml({ device, severity, reading }));
      }
    }
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
      className="h-[420px] w-full overflow-hidden rounded-input border border-neutral-border"
      aria-label="Devices map"
      role="region"
    />
  );
};
