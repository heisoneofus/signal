import React, { useMemo, useState } from "react";

import { Icon } from "./Icons";

function humanizeName(name = "") {
  return String(name).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatNumber(value = 0) {
  return Number(value || 0).toLocaleString();
}

function scoreTone(score = 0) {
  if (score >= 85) return "good";
  if (score >= 65) return "warn";
  return "bad";
}

export function DataQualityPanel({ payload, defaultOpen = false, open: controlledOpen, onOpenChange, compact = false }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const hasPayload = Boolean(payload);
  const profile = payload?.dataset_profile || {};
  const quality = payload?.analysis?.quality || {};
  const metrics = payload?.analysis?.metrics || {};
  const filters = payload?.dashboard_spec?.filters || [];
  const score = hasPayload ? profile.quality_score ?? (quality.issues?.length ? 100 - quality.issues.length * 8 : 100) : null;
  const dimensions = useMemo(() => {
    return profile.dimensions?.length ? profile.dimensions : metrics.dimensions || [];
  }, [metrics.dimensions, profile.dimensions]);
  const tone = hasPayload ? scoreTone(score) : "pending";
  const scoreLabel = hasPayload ? `${score}/100` : "Pending";

  function toggleOpen() {
    const nextOpen = !open;
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <section className={`quality-panel quality-panel--${tone}${compact ? " quality-panel--compact" : ""}`}>
      <button
        aria-expanded={open}
        className="quality-panel__toggle"
        onClick={toggleOpen}
        type="button"
      >
        <span>
          <Icon name="shield" size={16} />
          Data Quality Assessment
        </span>
        <strong>{scoreLabel}</strong>
      </button>

      <div className="quality-panel__summary">
        {hasPayload
          ? `Filters and dimensions ready: ${filters.length || 0} filters, ${dimensions.length || 0} dimensions`
          : "Load a session to inspect filters, dimensions, and quality signals."}
      </div>

      {open && hasPayload ? (
        <div className="quality-panel__body">
          <div className="quality-stat-grid">
            <div>
              <span>Rows</span>
              <strong>{formatNumber(profile.row_count)}</strong>
            </div>
            <div>
              <span>Columns</span>
              <strong>{formatNumber(profile.column_count)}</strong>
            </div>
            <div>
              <span>Missing Cells</span>
              <strong>{formatNumber(profile.missing_cells)}</strong>
            </div>
            <div>
              <span>Duplicate Rows</span>
              <strong>{formatNumber(profile.duplicate_rows)}</strong>
            </div>
          </div>

          <section>
            <div className="insight-heading">
              <Icon name="filter" size={16} />
              <span>Filters and dimensions</span>
            </div>
            <ul className="token-list">
              {[...new Set([...filters, ...dimensions])].map((name) => (
                <li key={name}>{humanizeName(name)}</li>
              ))}
            </ul>
          </section>

          <section>
            <div className="insight-heading">
              <Icon name="spark" size={16} />
              <span>Quality notes</span>
            </div>
            <div className="reasoning-box">
              {quality.notes || payload?.dashboard_spec?.data_quality_summary?.join(", ") || "No material quality issues were recorded."}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
