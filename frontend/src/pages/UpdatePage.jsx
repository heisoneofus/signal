import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { fetchSession, fetchSessions, finalizeSession, updateDashboard } from "../api";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { Icon } from "../components/Icons";
import { PlotlyChart } from "../components/PlotlyChart";

function humanizeName(name = "") {
  return String(name).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rememberSession(sessionId) {
  try {
    window.localStorage.setItem("signal.currentSessionId", sessionId);
  } catch {
    // Storage is a convenience only.
  }
}

function VisualReviewCard({ visual, figure, index, onUpdate, updating }) {
  const [prompt, setPrompt] = useState("");
  const title = visual.title || `Visual ${index + 1}`;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }
    await onUpdate(prompt.trim());
    setPrompt("");
  }

  return (
    <article className={`plan-card plan-card--chart plan-card--${visual.layout_size || "standard"}`}>
      <div className="plan-card__title">
        <span className="metric-icon">
          <Icon name={index === 0 ? "chart" : "dashboard"} size={18} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{humanizeName(visual.chart_type || "Chart")}</p>
        </div>
        <code className="ready-chip">{humanizeName(visual.status || "Ready")}</code>
      </div>
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
    } catch (submissionError) {
      setError(submissionError.message || "Unable to apply the dashboard update.");
    } finally {
      setSubmitting(false);
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
            <button className="button button--primary" disabled={!sessionId || finalizing} onClick={handleGenerateDashboard} type="button">
              <Icon name="dashboard" size={16} />
              {finalizing ? "Generating..." : "Generate Dashboard"}
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

        <div className="plan-card-list plan-card-list--canvas">
          {visuals.length ? (
            visuals.map((visual, index) => (
              <VisualReviewCard
                visual={visual}
                figure={figures[index]}
                index={index}
                key={visual.id || `${visual.title || "visual"}-${index}`}
                onUpdate={applyChartUpdate}
                updating={submitting}
              />
            ))
          ) : (
            <article className="plan-card">
              <div className="empty-state">Load a session to review the active visualization plan.</div>
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
