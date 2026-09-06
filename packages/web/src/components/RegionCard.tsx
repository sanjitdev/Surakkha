/**
 * `RegionCard` — shared chrome for the dashboard's region sections
 * (Map, Live Readings, Recent Incidents). Wraps each region's body in
 * the same surface treatment the `KpiStat` cards already use:
 *
 *   - `.metric-card` global class supplies `border`, 10px radius, 20px
 *     padding, and the layered `elevation.card` shadow.
 *   - `bg-neutral-surface` (white) on a `bg-neutral-page` (#F5F7F9)
 *     canvas gives the cards the lifted "instrument panel" feel
 *     without bespoke per-region CSS.
 *
 * The component owns the section's accessibility contract
 * (`role="region"` is implied by `<section>`, `aria-label` rides the
 * title) and the testid contract (`data-region`, `data-testid` both
 * pass through). The header is a flex row: title on the left, an
 * optional right slot for chip / count / status copy.
 *
 * `KpiStat` does NOT use `RegionCard` — its left-stripe severity
 * treatment + denser internal padding is a different visual class,
 * and forcing it through this primitive would lose the stripe.
 */
import { type ReactNode } from "react";

export interface RegionCardProps {
  readonly title: string;
  /**
   * `data-region` value (e.g. `"map"`, `"live-readings"`). Pinned
   * because the dashboard tests grep for it on the section element.
   */
  readonly region: string;
  /** `data-testid` value. Pinned because every region test pins it. */
  readonly testId: string;
  /** Optional right-aligned header slot (chip / count / status copy). */
  readonly rightSlot?: ReactNode;
  /** Region body (the empty-state block or the populated list). */
  readonly children: ReactNode;
}

const REGION_CLASSES = [
  "metric-card",
  "rounded-card",
  "border",
  "border-neutral-border",
  "bg-neutral-surface",
  "p-density-card",
].join(" ");

export const RegionCard = ({ title, region, testId, rightSlot, children }: RegionCardProps) => (
  <section data-testid={testId} data-region={region} aria-label={title} className={REGION_CLASSES}>
    <header className="flex items-center justify-between gap-3">
      <h2 className="text-md font-semibold text-neutral-body">{title}</h2>
      {rightSlot !== undefined ? <div className="shrink-0">{rightSlot}</div> : null}
    </header>
    {children}
  </section>
);
