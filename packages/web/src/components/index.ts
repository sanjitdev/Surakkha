/**
 * Components barrel — Surakkha web.
 *
 * Single export point for the shared component layer. Story 1.9 ships
 * the KpiStat card; later stories will add MetricCard, LiveReadingRow,
 * ScenarioTile, etc. Each new component lands in this barrel so the
 * router can import from one path.
 */
export { KpiStat } from "./KpiStat";
export type { KpiSeverity, KpiStatProps } from "./KpiStat";
