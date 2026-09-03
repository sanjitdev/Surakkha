/**
 * `AuditLogPage` — admin-facing `/audit` read surface.
 *
 * Renders a filter panel (actor chips + actor id input + event
 * substring + resource chip row + date-range preset) plus a results
 * panel (loading / error / empty / table). Each row expands to a
 * JSON payload view + an entity link when one is wired for the
 * row's resource type.
 *
 * RBAC: the router guards this route; here, the 403 fallback renders
 * `<RbacDenied>` without remounting the rest of the page tree.
 */
/* eslint-disable max-lines -- 4 components + 2 helpers; splitting deferred. */
import { type AuditLogEntry, type AuditLogResource } from "@surakkha/shared/audit";
import { useMemo, useState } from "react";

import { RbacDenied } from "../access/RbacDenied";
import { useCurrentRole } from "../auth/CurrentRoleContext";

import { AdminAuditLogRbacDeniedError } from "./AdminAuditLogRbacDeniedError";
import { type AuditLogHookFilters, useAuditLogList } from "./useAuditLogList";

type DateRangePreset = "24h" | "7d" | "30d" | "custom";
const DATE_RANGE_PRESETS: readonly DateRangePreset[] = ["24h", "7d", "30d", "custom"];

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const WINDOW_DAYS_24H = 1;
const WINDOW_DAYS_7D = 7;
const WINDOW_DAYS_30D = 30;
const WINDOW_MS_24H =
  WINDOW_DAYS_24H * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const WINDOW_MS_7D =
  WINDOW_DAYS_7D * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const WINDOW_MS_30D =
  WINDOW_DAYS_30D * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const ID_SHORT_PREFIX_LENGTH = 8;
const ISO_DATETIME_PREFIX_LENGTH = 19;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors `AuditLogResourceSchema` from `@surakkha/shared/audit`.
const RESOURCE_OPTIONS: readonly AuditLogResource[] = [
  "Device",
  "Reading",
  "Alert",
  "Incident",
  "Rule",
  "User",
  "School",
  "Notification",
  "Simulator",
  "SeverityBanner",
  "Attachment",
  "Session",
  "Other",
];

const sincePresetMsForPreset = (preset: DateRangePreset): number | undefined => {
  if (preset === "custom") return undefined;
  if (preset === "24h") return WINDOW_MS_24H;
  if (preset === "7d") return WINDOW_MS_7D;
  return WINDOW_MS_30D;
};

const OUTCOME_PILL_CLASS: Record<string, string> = {
  success: "bg-severity-healthy-bg text-severity-healthy-text",
  failure: "bg-severity-critical-bg text-severity-critical-text",
  allow: "bg-severity-warning-bg text-severity-warning-text",
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toISOString().replace("T", " ").slice(0, ISO_DATETIME_PREFIX_LENGTH);
};

const entityHrefFor = (entry: AuditLogEntry): string | null => {
  if (entry.resourceId === null) return null;
  if (!UUID_REGEX.test(entry.resourceId)) return null;
  if (entry.resource === "Incident") return `/incidents/${entry.resourceId}`;
  if (entry.resource === "Rule") return `/admin/thresholds?rule_id=${entry.resourceId}`;
  return null;
};

const entityLabelFor = (entry: AuditLogEntry): string => {
  if (entry.resourceId === null) return "—";
  const href = entityHrefFor(entry);
  if (href === null) return "—";
  return entry.resourceId.slice(0, ID_SHORT_PREFIX_LENGTH);
};

const actorLabelFor = (row: AuditLogEntry): string => {
  if (row.actorUserId === null) return "system";
  const payloadObj =
    typeof row.payload === "object" && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : null;
  const payloadRole =
    payloadObj && typeof payloadObj.actorRole === "string" ? payloadObj.actorRole : null;
  return payloadRole ?? row.actorUserId.slice(0, ID_SHORT_PREFIX_LENGTH);
};

export interface AuditLogPageProps {
  readonly testId?: string;
}

export const AuditLogPage = ({ testId = "audit-log-page" }: AuditLogPageProps) => {
  const [actorIds, setActorIds] = useState<readonly string[]>([]);
  const [event, setEvent] = useState<string>("");
  const [resource, setResource] = useState<AuditLogResource | "">("");
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actorInput, setActorInput] = useState<string>("");
  const [actorInputError, setActorInputError] = useState<string | null>(null);

  const filters: AuditLogHookFilters = useMemo<AuditLogHookFilters>(() => {
    const out: AuditLogHookFilters = {};
    if (actorIds.length > 0) {
      (out as { actorIds?: readonly string[] }).actorIds = actorIds;
    }
    if (event.length > 0) {
      (out as { event?: string }).event = event;
    }
    if (resource.length > 0) {
      (out as { resource?: AuditLogResource }).resource = resource as AuditLogResource;
    }
    (out as { preset?: string }).preset = preset;
    const ms = sincePresetMsForPreset(preset);
    if (ms !== undefined) {
      (out as { sincePresetMs?: number }).sincePresetMs = ms;
    }
    return out;
  }, [actorIds, event, resource, preset]);

  const { entries, total, truncated, query } = useAuditLogList(filters);

  const viewerRole = useCurrentRole();

  if (query.isError && query.error instanceof AdminAuditLogRbacDeniedError) {
    return <RbacDenied viewerRole={viewerRole} />;
  }

  const isFilterActive =
    actorIds.length > 0 || event.length > 0 || resource.length > 0 || preset !== "30d";

  return (
    <div data-testid={testId} className="p-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-body">Audit Log</h1>
      <p className="mb-6 text-md text-neutral-secondary">
        Admin-only audit trail — read-only record of every audit emit across the platform.
      </p>
      <AuditLogFilterPanel
        actorIds={actorIds}
        onRemoveActor={(id) => setActorIds((cur) => cur.filter((a) => a !== id))}
        actorInput={actorInput}
        onActorInputChange={(next) => {
          setActorInput(next);
          if (actorInputError !== null) setActorInputError(null);
        }}
        actorInputError={actorInputError}
        onAddActor={() => {
          const trimmed = actorInput.trim();
          if (trimmed.length === 0) return;
          if (!UUID_REGEX.test(trimmed)) {
            setActorInputError("Invalid actor ID — must be a UUID");
            return;
          }
          setActorInputError(null);
          setActorIds((cur) => (cur.includes(trimmed) ? cur : [...cur, trimmed]));
          setActorInput("");
        }}
        event={event}
        onEventChange={setEvent}
        resource={resource}
        onResourceChange={setResource}
        preset={preset}
        onPresetChange={setPreset}
      />
      <AuditLogResultsPanel
        query={query}
        entries={entries}
        total={total}
        isTruncated={truncated}
        isFiltered={isFilterActive}
        expandedId={expandedId}
        onToggleExpanded={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        onResetFilters={() => {
          setActorIds([]);
          setEvent("");
          setResource("");
          setPreset("30d");
          setActorInput("");
          setActorInputError(null);
        }}
      />
    </div>
  );
};

interface AuditLogFilterPanelProps {
  readonly actorIds: readonly string[];
  readonly onRemoveActor: (id: string) => void;
  readonly actorInput: string;
  readonly onActorInputChange: (next: string) => void;
  readonly actorInputError: string | null;
  readonly onAddActor: () => void;
  readonly event: string;
  readonly onEventChange: (next: string) => void;
  readonly resource: AuditLogResource | "";
  readonly onResourceChange: (next: AuditLogResource | "") => void;
  readonly preset: DateRangePreset;
  readonly onPresetChange: (next: DateRangePreset) => void;
}

const AuditLogFilterPanel = (props: AuditLogFilterPanelProps) => {
  const {
    actorIds,
    onRemoveActor,
    actorInput,
    onActorInputChange,
    actorInputError,
    onAddActor,
    event,
    onEventChange,
    resource,
    onResourceChange,
    preset,
    onPresetChange,
  } = props;
  return (
    <>
      <section
        aria-labelledby="actor-filter-heading"
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="actor-filter"
      >
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-labelledby` (ARIA spec). */}
        <h2 id="actor-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Actor
        </h2>
        {actorIds.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed="true"
            onClick={() => onRemoveActor(id)}
            data-testid={`actor-chip-${id}`}
            className="flex items-center gap-2 rounded-full border border-primary bg-primary px-3 py-1 text-sm text-white"
          >
            {id.slice(0, ID_SHORT_PREFIX_LENGTH)}
          </button>
        ))}
        <input
          type="text"
          value={actorInput}
          onChange={(e) => onActorInputChange(e.target.value)}
          placeholder="actor user id…"
          data-testid="actor-input"
          aria-label="Actor user id"
          className="rounded-md border border-neutral-border bg-white px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={onAddActor}
          data-testid="actor-add"
          className="rounded-md border border-neutral-border bg-white px-3 py-1 text-sm text-neutral-body"
        >
          Add
        </button>
        {actorInputError !== null && (
          <span
            data-testid="actor-input-error"
            role="alert"
            className="basis-full text-xs text-severity-critical-text"
          >
            {actorInputError}
          </span>
        )}
      </section>

      <section
        aria-labelledby="event-filter-heading"
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="event-filter"
      >
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-labelledby` (ARIA spec). */}
        <h2 id="event-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Event
        </h2>
        <input
          type="text"
          value={event}
          onChange={(e) => onEventChange(e.target.value)}
          placeholder="substring (e.g. incident)"
          data-testid="event-input"
          aria-label="Event substring filter"
          className="rounded-md border border-neutral-border bg-white px-2 py-1 text-sm"
        />
      </section>

      <section
        aria-labelledby="resource-filter-heading"
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="resource-filter"
      >
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-labelledby` (ARIA spec). */}
        <h2 id="resource-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Resource
        </h2>
        <button
          type="button"
          aria-pressed={resource === ""}
          onClick={() => onResourceChange("")}
          data-testid="resource-chip-any"
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
            resource === ""
              ? "border-primary bg-primary text-white"
              : "border-neutral-border bg-white text-neutral-body"
          }`}
        >
          Any
        </button>
        {RESOURCE_OPTIONS.map((r) => {
          const pressed = resource === r;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={pressed}
              onClick={() => onResourceChange(r)}
              data-testid={`resource-chip-${r}`}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                pressed
                  ? "border-primary bg-primary text-white"
                  : "border-neutral-border bg-white text-neutral-body"
              }`}
            >
              {r}
            </button>
          );
        })}
      </section>

      <section
        aria-labelledby="date-filter-heading"
        className="mb-6 flex flex-wrap items-center gap-2"
        data-testid="date-range-filter"
      >
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-labelledby` (ARIA spec). */}
        <h2 id="date-filter-heading" className="mr-2 text-sm font-medium text-neutral-body">
          Range
        </h2>
        {DATE_RANGE_PRESETS.map((p) => {
          const isStub = p === "custom";
          return (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => onPresetChange(p)}
              disabled={isStub}
              aria-describedby={isStub ? "range-custom-coming-soon" : undefined}
              title={isStub ? "Custom date range inputs are deferred to a future story" : undefined}
              data-testid={`range-${p}`}
              className={`rounded-md border px-3 py-1 text-sm ${
                preset === p
                  ? "border-primary bg-primary text-white"
                  : "border-neutral-border bg-white text-neutral-body"
              } ${isStub ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {p === "24h"
                ? "Last 24h"
                : p === "7d"
                  ? "Last 7d"
                  : p === "30d"
                    ? "Last 30d"
                    : "Custom"}
            </button>
          );
        })}
        {/* eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-describedby` (ARIA spec). */}
        <span id="range-custom-coming-soon" className="sr-only">
          Custom date range inputs are deferred to a future story.
        </span>
      </section>
    </>
  );
};

interface AuditLogResultsPanelProps {
  readonly query: ReturnType<typeof useAuditLogList>["query"];
  readonly entries: readonly AuditLogEntry[];
  readonly total: number;
  readonly isTruncated: boolean;
  readonly isFiltered: boolean;
  readonly expandedId: string | null;
  readonly onToggleExpanded: (id: string) => void;
  readonly onResetFilters: () => void;
}

const AuditLogResultsPanel = (props: AuditLogResultsPanelProps) => {
  const {
    query,
    entries,
    total,
    isTruncated,
    isFiltered,
    expandedId,
    onToggleExpanded,
    onResetFilters,
  } = props;
  if (query.isLoading) {
    return (
      <div data-testid="audit-log-loading" className="text-md text-neutral-secondary">
        Loading audit log…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div data-testid="audit-log-error" className="text-md text-severity-critical-text">
        Unable to load audit log. Retry shortly.
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div data-testid="audit-log-empty" className="text-md text-neutral-secondary">
        {isFiltered ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>No audit events match the current filters.</span>
            <button
              type="button"
              onClick={onResetFilters}
              data-testid="audit-log-reset-filters"
              className="rounded-md border border-primary bg-primary px-3 py-1 text-sm text-white"
            >
              Show last 30d
            </button>
          </div>
        ) : (
          "No audit events yet. The audit writer ships in a future release — expand the date range to confirm."
        )}
      </div>
    );
  }
  return (
    <>
      <div className="mb-2 text-md text-neutral-secondary" data-testid="audit-log-summary">
        {isTruncated
          ? `Showing ${entries.length} of ${total}+ events (most recent first).`
          : `Showing all ${entries.length} event${entries.length === 1 ? "" : "s"}.`}
      </div>
      <table className="w-full border-collapse" data-testid="audit-log-table">
        <thead>
          <tr className="border-b border-neutral-border text-left text-sm text-neutral-secondary">
            <th className="py-2 pr-4">Actor</th>
            <th className="py-2 pr-4">Event</th>
            <th className="py-2 pr-4">Resource</th>
            <th className="py-2 pr-4">Resource ID</th>
            <th className="py-2 pr-4">Outcome</th>
            <th className="py-2 pr-4">Created</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <AuditLogRow
              key={entry.id}
              row={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() => onToggleExpanded(entry.id)}
            />
          ))}
        </tbody>
      </table>
    </>
  );
};

interface AuditLogRowProps {
  readonly row: AuditLogEntry;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
}

const AuditLogRow = ({ row, isExpanded, onToggle }: AuditLogRowProps) => {
  const actorLabel = actorLabelFor(row);
  const outcomeClass = OUTCOME_PILL_CLASS[row.outcome] ?? "bg-neutral-bg text-neutral-secondary";
  const entityHref = entityHrefFor(row);
  const entityLabel = entityLabelFor(row);
  // Guard against a circular payload crashing JSON.stringify mid-render.
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(
      {
        id: row.id,
        actorUserId: row.actorUserId,
        auditAction: row.auditAction,
        resource: row.resource,
        resourceId: row.resourceId,
        payload: row.payload,
        outcome: row.outcome,
        createdAt: row.createdAt,
      },
      null,
      2,
    );
  } catch (err) {
    payloadJson = `Unserialisable payload: ${err instanceof Error ? err.message : String(err)}`;
  }
  return (
    <>
      <tr
        data-testid={`audit-log-row-${row.id}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={`audit-log-detail-${row.id}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="cursor-pointer border-b border-neutral-border text-sm text-neutral-body hover:bg-neutral-bg focus:bg-neutral-bg focus:outline focus:outline-2 focus:outline-primary"
      >
        <td className="py-2 pr-4">{actorLabel}</td>
        <td className="py-2 pr-4">{row.auditAction}</td>
        <td className="py-2 pr-4">{row.resource}</td>
        <td className="py-2 pr-4">{row.resourceId === null ? "—" : entityLabel}</td>
        <td className="py-2 pr-4">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${outcomeClass}`}
            data-testid={`audit-log-outcome-${row.id}`}
          >
            {row.outcome}
          </span>
        </td>
        <td className="py-2 pr-4">{formatDate(row.createdAt)}</td>
      </tr>
      {isExpanded && (
        <tr
          // eslint-disable-next-line react/forbid-dom-props -- id is required by `aria-controls` (ARIA spec).
          id={`audit-log-detail-${row.id}`}
          data-testid={`audit-log-detail-${row.id}`}
          className="bg-neutral-bg"
        >
          <td colSpan={6} className="px-4 py-3 text-sm">
            <pre className="overflow-auto rounded-md border border-neutral-border bg-white p-3 text-xs">
              {payloadJson}
            </pre>
            <div className="mt-3">
              {entityHref === null ? (
                <span
                  data-testid={`audit-log-no-entity-${row.id}`}
                  className="text-md text-neutral-secondary"
                >
                  No entity linked to this event.
                </span>
              ) : (
                <a
                  data-testid={`audit-log-entity-link-${row.id}`}
                  href={entityHref}
                  onClick={(e) => e.stopPropagation()}
                  className="text-md text-primary underline"
                >
                  {row.resource === "Incident"
                    ? "View incident"
                    : row.resource === "Rule"
                      ? "Open rule"
                      : `Open ${row.resource}`}
                </a>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};
