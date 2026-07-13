import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { fetchSession, fetchSessions, finalizeSession, renderSessionFigures, updateDashboard } from "../api";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { Icon } from "../components/Icons";
import { PlotlyChart } from "../components/PlotlyChart";

function humanizeName(name = "") {
  return String(name).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatConfidence(value) {
  if (value === null || value === undefined) {
    return "Confidence pending";
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "Confidence pending";
  }
  return `${Math.round(numeric * 100)}% confidence`;
}

function confidenceScore(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function needsReview(visual) {
  const score = confidenceScore(visual?.confidence);
  return score === null || score < 0.7;
}

function rememberSession(sessionId) {
  try {
    window.localStorage.setItem("signal.currentSessionId", sessionId);
  } catch {
    // Storage is a convenience only.
  }
}

function VisualReviewCard({ visual, figure, index, onUpdate, updating, priority = "secondary" }) {
  const [prompt, setPrompt] = useState("");
  const title = visual.title || `Visual ${index + 1}`;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }
    await onUpdate(`For ${title}, ${prompt.trim()}`);
    setPrompt("");
  }

  return (
    <article className={`plan-card plan-card--chart plan-card--${priority} plan-card--${visual.layout_size || "standard"}`}>
      <div className="plan-card__title">
        <span className="metric-icon">
          <Icon name={index === 0 ? "chart" : "dashboard"} size={18} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>
            {humanizeName(visual.chart_type || "Chart")} - {formatConfidence(visual.confidence)}
          </p>
        </div>
        <div className="plan-card__signals">
          {needsReview(visual) ? <span className="review-signal">Needs review</span> : null}
          <code className="ready-chip">{humanizeName(visual.status || "Ready")}</code>
        </div>
      </div>
      {priority === "primary" ? (
        <div className="decision-strip">
          <span>Primary recommendation</span>
          <strong>{visual.rationale || "Review this visual first; it anchors the dashboard narrative."}</strong>
        </div>
      ) : null}
      <div className="review-chart-frame">
        {figure ? (
          <PlotlyChart figure={figure} title={title} />
        ) : (
          <div className="visual-placeholder">
            <Icon name="signal" size={28} />
          </div>
        )}
      </div>
      <form className="prompt-inline prompt-inline--editable" onSubmit={handleSubmit}>
        <Icon name="message" size={15} />
        <input
          aria-label={`Update prompt for ${title}`}
          placeholder='e.g., "Make this weekly instead of daily"'
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <button aria-label={`Update ${title}`} disabled={updating || !prompt.trim()} type="submit">
          {updating ? "Updating" : "Update"}
        </button>
      </form>
    </article>
  );
}

export function UpdatePage() {
  const { sessionId: routeSessionId = "" } = useParams();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(routeSessionId);
  const [loading, setLoading] = useState(Boolean(routeSessionId));
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [dashboardPrompt, setDashboardPrompt] = useState("");
  const [appliedDashboardPrompt, setAppliedDashboardPrompt] = useState("");
  const [reviewFocus, setReviewFocus] = useState("all");
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadSessions() {
      try {
        const response = await fetchSessions();
        if (!active) return;
        const items = response.items || [];
        setSessions(items);
        if (!routeSessionId && !sessionId && items[0]?.session_id) {
          setSessionId(items[0].session_id);
        }
      } catch {
        if (active) {
          setSessions([]);
        }
      }
    }
    loadSessions();
    return () => {
      active = false;
    };
  }, [routeSessionId, sessionId]);

  useEffect(() => {
    let active = true;

    async function loadSession(targetSessionId) {
      if (!targetSessionId) {
        setPayload(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const detail = await fetchSession(targetSessionId);
        if (active) {
          setPayload(detail);
          setSessionId(targetSessionId);
          rememberSession(targetSessionId);
        }
        if (active && detail?.dashboard_spec?.visuals?.length && !detail?.figures?.length) {
          const response = await renderSessionFigures(targetSessionId, {});
          if (active) {
            setPayload((current) => {
              if (!current || current.session_id !== targetSessionId) {
                return current;
              }
              return {
                ...current,
                figures: response.figures || [],
              };
            });
          }
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Unable to load the requested session.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadSession(routeSessionId || sessionId);
    return () => {
      active = false;
    };
  }, [routeSessionId, sessionId]);

  async function handleSessionChange(event) {
    const nextSessionId = event.target.value;
    setSessionId(nextSessionId);
    if (nextSessionId) {
      navigate(`/update/${nextSessionId}`);
    }
  }

  async function applyChartUpdate(prompt) {
    if (!sessionId.trim()) {
      setError("Choose a session before applying an update.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const updated = await updateDashboard(sessionId.trim(), prompt);
      setPayload((current) => ({
        ...(current || {}),
        ...updated,
        status: updated.session_status,
      }));
      return true;
    } catch (submissionError) {
      setError(submissionError.message || "Unable to apply the dashboard update.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDashboardUpdate(event) {
    event.preventDefault();
    const prompt = dashboardPrompt.trim();
    if (!prompt) {
      return;
    }
    const applied = await applyChartUpdate(prompt);
    if (applied) {
      setAppliedDashboardPrompt(prompt);
      setDashboardPrompt("");
    }
  }

  async function handleGenerateDashboard() {
    if (!sessionId) {
      return;
    }
    setFinalizing(true);
    setError("");
    try {
      const finalized = await finalizeSession(sessionId);
      setPayload((current) => ({ ...(current || {}), ...finalized, status: finalized.session_status }));
      rememberSession(sessionId);
      navigate(`/results/${sessionId}`);
    } catch (finalizeError) {
      setError(finalizeError.message || "Unable to generate the final dashboard.");
    } finally {
      setFinalizing(false);
    }
  }

  const visuals = payload?.dashboard_spec?.visuals || [];
  const figures = payload?.figures || [];
  const visualEntries = visuals.map((visual, index) => ({ figure: figures[index], index, visual }));
  const attentionEntries = visualEntries
    .filter(({ visual }) => needsReview(visual))
    .sort((left, right) => {
      const leftScore = confidenceScore(left.visual.confidence) ?? -1;
      const rightScore = confidenceScore(right.visual.confidence) ?? -1;
      return leftScore - rightScore;
    });
  const visibleEntries = reviewFocus === "attention" ? attentionEntries : visualEntries;
  const attentionCount = attentionEntries.length;
  const draftReady = Boolean(payload);
  const generateDisabled = !sessionId || loading || submitting || finalizing || !draftReady;
  const generateButtonLabel = loading
    ? "Loading Draft..."
    : submitting
      ? "Applying Updates..."
      : finalizing
        ? "Generating..."
        : "Generate Dashboard";
  const reviewQueueLabel = loading
    ? "Loading draft..."
    : visuals.length
      ? `${visuals.length} proposed visual${visuals.length === 1 ? "" : "s"}`
      : "No proposed visuals";
  const nextDecisionLabel = loading
    ? "Wait for draft details"
    : reviewFocus === "attention" && attentionCount
      ? `Inspect ${attentionCount} uncertain visual${attentionCount === 1 ? "" : "s"}`
      : visuals.length
      ? "Approve the lead chart, then tune supporting views"
      : "Load a session to begin";
  const currentLayout = payload?.dashboard_spec?.layout || "grid";
  const currentTheme = payload?.dashboard_spec?.theme || "light";
  const dashboardSuggestions = [
    currentLayout === "tabs" ? "Use sections layout" : "Use tabs layout",
    currentTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
  ];

  return (
    <section className="review-page review-page--wide">
      <div className="review-plan">
        <div className="review-plan__header">
          <div>
            <h1>
              <Icon name="spark" size={20} />
              Review Dashboard Draft
            </h1>
            <p>Inspect chart previews, filters, dimensions, and targeted chart changes before publishing.</p>
          </div>
          <div className="dashboard-actions">
            <Link className="button button--secondary" to="/sessions">
              Sessions
            </Link>
            <button className="button button--primary" disabled={generateDisabled} onClick={handleGenerateDashboard} type="button">
              <Icon name="dashboard" size={16} />
              {generateButtonLabel}
            </button>
          </div>
        </div>

        <div className="review-form review-form--compact">
          <label className="field">
            <span>Session ID</span>
            <select aria-label="Session ID" value={sessionId} onChange={handleSessionChange}>
              <option value="">Choose a session</option>
              {sessions.map((item) => (
                <option key={item.session_id} value={item.session_id}>
                  {item.title || item.session_id} ({item.session_id})
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="status status--error">{error}</p> : null}
          {loading ? <p className="status">Loading session...</p> : null}
        </div>

        <div className="review-decision-bar">
          <div>
            <span>Review queue</span>
            <strong>{reviewQueueLabel}</strong>
          </div>
          <div>
            <span>Next decision</span>
            <strong>{nextDecisionLabel}</strong>
          </div>
          <div>
            <span>Output</span>
            <strong>{loading ? "Loading draft" : payload?.dashboard_spec?.layout ? humanizeName(payload.dashboard_spec.layout) : "Dashboard draft"}</strong>
          </div>
        </div>

        <section className="review-priority" aria-labelledby="review-priority-title">
          <div className="review-priority__intro">
            <span className="review-priority__marker" aria-hidden="true">
              <Icon name="signal" size={18} />
            </span>
            <div>
              <span className="review-priority__eyebrow">Review priority</span>
              <h2 id="review-priority-title">Start with uncertainty</h2>
              <p>Surface pending and sub-70% confidence visuals before you publish.</p>
            </div>
          </div>
          <div className="review-priority__controls">
            <div className="review-priority__count" aria-live="polite">
              <strong>{loading ? "—" : attentionCount}</strong>
              <span>{loading ? "checking confidence" : `of ${visuals.length} need attention`}</span>
            </div>
            <div className="review-priority__switch" aria-label="Review focus">
              <button aria-pressed={reviewFocus === "all"} disabled={!draftReady || loading} onClick={() => setReviewFocus("all")} type="button">
                All visuals
              </button>
              <button
                aria-pressed={reviewFocus === "attention"}
                disabled={!draftReady || loading || !attentionCount}
                onClick={() => setReviewFocus("attention")}
                type="button"
              >
                Needs attention {attentionCount ? `(${attentionCount})` : ""}
              </button>
            </div>
          </div>
        </section>

        <section className="dashboard-directive" aria-labelledby="dashboard-directive-title">
          <div className="dashboard-directive__intro">
            <span className="dashboard-directive__icon">
              <Icon name="spark" size={18} />
            </span>
            <div>
              <span className="dashboard-directive__eyebrow">Dashboard direction</span>
              <h2 id="dashboard-directive-title">Tune the whole canvas</h2>
              <p>Change the layout or theme once, then refine individual charts below.</p>
            </div>
          </div>
          <form className="dashboard-directive__form" onSubmit={handleDashboardUpdate}>
            <label htmlFor="dashboard-direction-prompt">Instruction</label>
            <div className="dashboard-directive__composer">
              <input
                disabled={!draftReady || loading || submitting}
                id="dashboard-direction-prompt"
                onChange={(event) => setDashboardPrompt(event.target.value)}
                placeholder='e.g., "Use tabs layout" or "Switch to dark theme"'
                value={dashboardPrompt}
              />
              <button className="button button--primary" disabled={!draftReady || loading || submitting || !dashboardPrompt.trim()} type="submit">
                {submitting ? "Applying..." : "Apply to dashboard"}
              </button>
            </div>
            <div className="dashboard-directive__suggestions" aria-label="Dashboard direction examples">
              <span>Try</span>
              {dashboardSuggestions.map((suggestion) => (
                <button
                  disabled={!draftReady || loading || submitting}
                  key={suggestion}
                  onClick={() => setDashboardPrompt(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            {appliedDashboardPrompt ? (
              <p className="dashboard-directive__status" role="status">
                <Icon name="check" size={15} /> Applied: {appliedDashboardPrompt}
              </p>
            ) : null}
          </form>
        </section>

        <div className={`plan-card-list plan-card-list--canvas${reviewFocus === "attention" ? " plan-card-list--attention" : ""}`}>
          {visibleEntries.length ? (
            visibleEntries.map(({ figure, index, visual }) => (
              <VisualReviewCard
                visual={visual}
                figure={figure}
                index={index}
                key={visual.id || `${visual.title || "visual"}-${index}`}
                onUpdate={applyChartUpdate}
                priority={reviewFocus === "all" && index === 0 ? "primary" : "secondary"}
                updating={submitting}
              />
            ))
          ) : (
            <article className="plan-card">
              <div className="empty-state">
                {loading
                  ? "Loading the active visualization plan..."
                  : reviewFocus === "attention"
                    ? "Every visual meets the confidence threshold. Review the full dashboard when you are ready."
                    : "Load a session to review the active visualization plan."}
              </div>
            </article>
          )}
        </div>
      </div>

      <aside className="review-reasoning">
        <DataQualityPanel payload={payload} />

        <section>
          <div className="insight-heading">
            <Icon name="spark" size={16} />
            <span>AI Reasoning</span>
          </div>
          <div className="reasoning-box">
            {payload?.dashboard_spec?.plan_summary ||
              "Prompt-based changes are applied against the current dashboard spec while preserving prior transformations."}
          </div>
        </section>

        <section>
          <div className="insight-heading">
            <Icon name="filter" size={16} />
            <span>Applied Transformations</span>
          </div>
          <ul className="transform-list">
            {(payload?.dashboard_spec?.transform_history?.length
              ? payload.dashboard_spec.transform_history
              : ["Preserved source data lineage", "Regenerated compatible figures", "Updated active dashboard spec"]
            ).map((item) => (
              <li key={item}>
                <Icon name="filter" size={15} />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </section>
  );
}
