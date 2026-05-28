import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { fetchSession, patchSession, renderSessionFigures } from "../api";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { Icon } from "../components/Icons";
import { PlotlyChart } from "../components/PlotlyChart";

function compactList(values = [], fallback = "None inferred") {
  return values?.length ? values.join(", ") : fallback;
}

function humanizeName(name = "") {
  return String(name).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isDateLikeValue(value = "") {
  const text = String(value).trim();
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\b|T)/.test(text);
}

function isTemporalFilter(filterName = "", values = []) {
  const normalizedName = String(filterName).toLowerCase();
  const temporalName = /(^|[_\s-])(date|time|timestamp|day|week|month|year|created|updated)([_\s-]|$)/.test(normalizedName);
  if (temporalName) {
    return true;
  }
  const sample = values.slice(0, 5);
  return sample.length > 0 && sample.every(isDateLikeValue);
}

function rememberSession(sessionId) {
  try {
    window.localStorage.setItem("signal.currentSessionId", sessionId);
  } catch {
    // Non-critical navigation hint.
  }
}

function MetricCard({ icon, label, value }) {
  return (
    <article className="metric-card metric-card--compact">
      <span className="metric-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

function ExportMenu({ sessionId, targetRef, selectedFilters }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");

  async function exportPng() {
    setOpen(false);
    setStatus("Preparing PNG...");
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(targetRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `${sessionId}_dashboard.png`;
      link.href = dataUrl;
      link.click();
      setStatus("PNG export ready");
    } catch {
      setStatus("PNG export is unavailable in this browser.");
    }
  }

  async function exportPdf() {
    setOpen(false);
    setStatus("Preparing PDF...");
    try {
      const [{ toPng }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
      const dataUrl = await toPng(targetRef.current, { cacheBust: true, pixelRatio: 2 });
      const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: "a4" });
      const width = pdf.internal.pageSize.getWidth();
      const height = pdf.internal.pageSize.getHeight();
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
      pdf.save(`${sessionId}_dashboard.pdf`);
      setStatus("PDF export ready");
    } catch {
      window.print();
      setStatus("Opened browser print dialog for PDF export.");
    }
  }

  async function copySnapshotUrl() {
    const params = new URLSearchParams();
    Object.entries(selectedFilters).forEach(([key, values]) => {
      if (values?.length) {
        params.set(key, values.join(","));
      }
    });
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const url = `${window.location.origin}/results/${sessionId}${suffix}`;
    await navigator.clipboard?.writeText(url);
    setOpen(false);
    setStatus("Snapshot URL copied");
  }

  return (
    <div className="export-menu">
      <button className="button button--secondary" type="button" onClick={() => setOpen((current) => !current)}>
        <Icon name="download" size={16} />
        Export
      </button>
      {open ? (
        <div className="export-menu__list" role="menu">
          <button role="menuitem" type="button" onClick={exportPdf}>PDF</button>
          <button role="menuitem" type="button" onClick={exportPng}>PNG</button>
          <button role="menuitem" type="button" onClick={copySnapshotUrl}>Snapshot URL</button>
        </div>
      ) : null}
      {status ? <span className="export-status">{status}</span> : null}
    </div>
  );
}

function FilterChips({ payload, selectedFilters, onChange }) {
  const options = payload?.dataset_profile?.filter_options || {};
  const filters = payload?.dashboard_spec?.filters || Object.keys(options);
  const visibleFilters = filters.filter((filterName) => {
    const values = options[filterName] || [];
    return values.length > 0 && !isTemporalFilter(filterName, values);
  });

  if (!visibleFilters.length) {
    return null;
  }

  return (
    <div className="filter-chip-row" aria-label="Dashboard filters">
      {visibleFilters.map((filterName) => {
        const values = options[filterName] || [];
        const selected = selectedFilters[filterName] || [];
        return (
          <div className="filter-chip-group" key={filterName}>
            <span>{humanizeName(filterName)}</span>
            <button
              className={`filter-chip${selected.length === 0 ? " filter-chip--active" : ""}`}
              onClick={() => onChange(filterName, "__all__")}
              type="button"
            >
              {humanizeName(filterName)}: All
            </button>
            {values.slice(0, 12).map((value) => (
              <button
                className={`filter-chip${selected.includes(value) ? " filter-chip--active" : ""}`}
                key={`${filterName}-${value}`}
                onClick={() => onChange(filterName, value)}
                type="button"
              >
                {humanizeName(filterName)}: {humanizeName(value)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function InsightPanel({ payload, open, onOpenChange }) {
  const metrics = payload.analysis?.metrics || {};

  return (
    <aside className="insight-panel">
      <DataQualityPanel payload={payload} compact open={open} onOpenChange={onOpenChange} />
      {open ? (
        <section>
          <div className="insight-heading">
            <Icon name="spark" size={16} />
            <span>Primary metrics</span>
          </div>
          <div className="reasoning-box">{compactList(metrics.primary_metrics)}</div>
        </section>
      ) : null}
    </aside>
  );
}

export function ResultsPage() {
  const { sessionId = "" } = useParams();
  const exportTargetRef = useRef(null);
  const [payload, setPayload] = useState(null);
  const [figures, setFigures] = useState([]);
  const [selectedFilters, setSelectedFilters] = useState({});
  const [draggedVisualId, setDraggedVisualId] = useState("");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSession() {
      setLoading(true);
      setError("");
      try {
        const session = await fetchSession(sessionId);
        if (active) {
          setPayload(session);
          setFigures(session.figures || []);
          rememberSession(sessionId);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Unable to load this session.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (sessionId) {
      loadSession();
    }

    return () => {
      active = false;
    };
  }, [sessionId]);

  const cards = useMemo(() => {
    const metrics = payload?.analysis?.metrics || {};
    const profile = payload?.dataset_profile || {};
    const qualityIssues = payload?.analysis?.quality?.issues || [];
    return [
      { icon: "chart", label: "Visuals", value: payload?.dashboard_spec?.visuals?.length || figures.length || 0 },
      { icon: "database", label: "Rows", value: (profile.row_count || 0).toLocaleString() },
      { icon: "trend", label: "KPI Count", value: metrics.primary_metrics?.length || 0 },
      { icon: "shield", label: "Quality Issues", value: qualityIssues.length },
    ];
  }, [figures.length, payload]);

  async function handleFilterChange(filterName, value) {
    const nextFilters = {
      ...selectedFilters,
      [filterName]:
        value === "__all__"
          ? []
          : selectedFilters[filterName]?.includes(value)
            ? selectedFilters[filterName].filter((item) => item !== value)
            : [...(selectedFilters[filterName] || []), value],
    };
    setSelectedFilters(nextFilters);
    const activeFilters = Object.fromEntries(
      Object.entries(nextFilters).filter(([, values]) => values?.length),
    );
    const response = await renderSessionFigures(sessionId, activeFilters);
    setFigures(response.figures || []);
  }

  async function persistVisualOrder(nextVisuals, nextFigures) {
    if (!payload) {
      return;
    }
    setPayload({
      ...payload,
      dashboard_spec: {
        ...payload.dashboard_spec,
        visuals: nextVisuals,
      },
      figures: nextFigures,
    });
    setFigures(nextFigures);
    try {
      const patched = await patchSession(sessionId, { visual_order: nextVisuals.map((visual) => visual.id) });
      setPayload(patched);
      setFigures(patched.figures || nextFigures);
    } catch (patchError) {
      setError(patchError.message || "Unable to save chart order.");
    }
  }

  async function moveVisual(index, direction) {
    const visuals = [...(payload?.dashboard_spec?.visuals || [])];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= visuals.length) {
      return;
    }
    const nextFigures = [...figures];
    [visuals[index], visuals[nextIndex]] = [visuals[nextIndex], visuals[index]];
    [nextFigures[index], nextFigures[nextIndex]] = [nextFigures[nextIndex], nextFigures[index]];
    await persistVisualOrder(visuals, nextFigures);
  }

  async function dropVisual(targetIndex) {
    const visuals = [...(payload?.dashboard_spec?.visuals || [])];
    const sourceIndex = visuals.findIndex((visual) => visual.id === draggedVisualId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }
    const nextFigures = [...figures];
    const [visual] = visuals.splice(sourceIndex, 1);
    const [figure] = nextFigures.splice(sourceIndex, 1);
    visuals.splice(targetIndex, 0, visual);
    nextFigures.splice(targetIndex, 0, figure);
    setDraggedVisualId("");
    await persistVisualOrder(visuals, nextFigures);
  }

  if (loading) {
    return <section className="state-panel"><p className="status">Loading session...</p></section>;
  }

  if (error && !payload) {
    return <section className="state-panel"><p className="status status--error">{error}</p></section>;
  }

  if (!payload) {
    return <section className="state-panel"><p className="status">No session data found.</p></section>;
  }

  const visuals = payload.dashboard_spec?.visuals || [];
  const dashboardTitle = payload.dashboard_spec?.title || "Signal Dashboard";

  return (
    <section className="dashboard-page" ref={exportTargetRef}>
      <div className="dashboard-toolbar">
        <div>
          <h1>{dashboardTitle}</h1>
          <p>Generated by Signal AI - Session {payload.session_id}</p>
          {error ? <p className="status status--error">{error}</p> : null}
        </div>
        <div className="dashboard-actions">
          <ExportMenu sessionId={payload.session_id} selectedFilters={selectedFilters} targetRef={exportTargetRef} />
          <Link className="button button--primary" to={`/update/${payload.session_id}`}>
            <Icon name="review" size={16} />
            Update
          </Link>
        </div>
      </div>

      <FilterChips payload={payload} selectedFilters={selectedFilters} onChange={handleFilterChange} />

      <div className="metrics-grid">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className={`dashboard-content${qualityOpen ? " dashboard-content--with-insights" : ""}`}>
        <InsightPanel payload={payload} open={qualityOpen} onOpenChange={setQualityOpen} />

        <div className="chart-layout">
          {figures.length ? (
            figures.map((figure, index) => {
              const visual = visuals[index] || {};
              const title = visual.title || `Figure ${index + 1}`;
              return (
                <article
                  className={`dashboard-chart dashboard-chart--${visual.layout_size || "standard"}`}
                  key={`${payload.session_id}-${visual.id || index}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropVisual(index)}
                >
                  <div className="chart-heading">
                    <div>
                      <h2>{title}</h2>
                      <p>{humanizeName(visual.chart_type || "Plotly")} - Cleaned and rendered</p>
                    </div>
                    <div className="chart-heading__actions">
                      <button
                        aria-label={`Drag to reorder ${title}`}
                        className="icon-button icon-button--drag"
                        draggable
                        onDragEnd={() => setDraggedVisualId("")}
                        onDragStart={(event) => {
                          setDraggedVisualId(visual.id || "");
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        type="button"
                      >
                        <Icon name="grip" size={16} />
                      </button>
                      <button
                        className="icon-button icon-button--up"
                        disabled={index === 0}
                        onClick={() => moveVisual(index, -1)}
                        type="button"
                        aria-label={`Move ${title} up`}
                      >
                        <Icon name="arrow" size={16} />
                      </button>
                      <button
                        className="icon-button icon-button--down"
                        disabled={index === visuals.length - 1}
                        onClick={() => moveVisual(index, 1)}
                        type="button"
                        aria-label={`Move ${title} down`}
                      >
                        <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  </div>
                  <PlotlyChart figure={figure} title={title} />
                </article>
              );
            })
          ) : (
            <article className="dashboard-chart dashboard-chart--empty">
              <h2>Analysis-only session</h2>
              <p>No figures are stored for this session yet. Generate the dashboard from the review page.</p>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
