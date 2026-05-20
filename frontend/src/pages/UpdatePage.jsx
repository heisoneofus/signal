import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { fetchSession, updateDashboard } from "../api";
import { Icon } from "../components/Icons";
import { PlotlyChart } from "../components/PlotlyChart";

function VisualPlanCard({ visual, index }) {
  return (
    <article className="plan-card">
      <div className="plan-card__title">
        <span className="metric-icon">
          <Icon name={index === 0 ? "chart" : "dashboard"} size={18} />
        </span>
        <div>
          <h2>{visual.title || `Visual ${index + 1}`}</h2>
          <p>{visual.chart_type || "Chart"}</p>
        </div>
        <code className="ready-chip">Ready</code>
      </div>
      <div className="visual-placeholder">
        <Icon name="signal" size={28} />
      </div>
      <div className="prompt-inline">
        <Icon name="message" size={15} />
        <span>e.g., "Make this weekly instead of daily"</span>
        <button type="button">Update</button>
      </div>
    </article>
  );
}

export function UpdatePage() {
  const { sessionId: routeSessionId = "" } = useParams();
  const [sessionId, setSessionId] = useState(routeSessionId);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(Boolean(routeSessionId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

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

    loadSession(routeSessionId);
    return () => {
      active = false;
    };
  }, [routeSessionId]);

  async function handleLoad() {
    setLoading(true);
    setError("");
    try {
      const detail = await fetchSession(sessionId);
      setPayload(detail);
    } catch (loadError) {
      setError(loadError.message || "Unable to load the requested session.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!sessionId.trim()) {
      setError("Enter a session id before applying an update.");
      return;
    }
    if (!prompt.trim()) {
      setError("Describe the dashboard change you want to apply.");
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
      setPrompt("");
    } catch (submissionError) {
      setError(submissionError.message || "Unable to apply the dashboard update.");
    } finally {
      setSubmitting(false);
    }
  }

  const visuals = payload?.dashboard_spec?.visuals || [];

  return (
    <section className="review-page">
      <div className="review-plan">
        <div className="review-plan__header">
          <div>
            <h1>
              <Icon name="spark" size={20} />
              AI Analysis Plan
            </h1>
            <p>Review the proposed visualization structures. Modify using prompts.</p>
          </div>
          <Link className="button button--secondary" to="/sessions">
            Sessions
          </Link>
        </div>

        <form className="review-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Session ID</span>
            <div className="inline-field">
              <input aria-label="Session ID" value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
              <button type="button" className="button button--secondary" onClick={handleLoad} disabled={loading}>
                {loading ? "Loading..." : "Load"}
              </button>
            </div>
          </label>

          <label className="field">
            <span>Update Prompt</span>
            <textarea
              aria-label="Update Prompt"
              rows={4}
              placeholder="Change chart type, add a filter, alter aggregation, or adjust layout."
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          {error ? <p className="status status--error">{error}</p> : null}

          <button type="submit" className="button button--primary" disabled={submitting}>
            <Icon name="review" size={16} />
            {submitting ? "Applying..." : "Apply Update"}
          </button>
        </form>

        <div className="plan-card-list">
          {visuals.length ? (
            visuals.map((visual, index) => <VisualPlanCard visual={visual} index={index} key={`${visual.title || "visual"}-${index}`} />)
          ) : (
            <article className="plan-card">
              <div className="empty-state">Load a session to review the active visualization plan.</div>
            </article>
          )}
        </div>
      </div>

      <aside className="review-reasoning">
        <section>
          <div className="insight-heading">
            <Icon name="shield" size={16} />
            <span>Data Quality Assessment</span>
          </div>
          <code className="ready-chip">Score: 92/100</code>
          <p>
            Signal preserves the existing data pipeline, then updates only the requested visual structure and figure JSON.
          </p>
        </section>

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

        {payload?.figures?.length ? (
          <section>
            <div className="insight-heading">
              <Icon name="dashboard" size={16} />
              <span>Updated charts</span>
            </div>
            <div className="mini-chart-list">
              {payload.figures.map((figure, index) => (
                <article className="mini-chart-card" key={`${payload.session_id}-update-${index}`}>
                  <PlotlyChart figure={figure} title={payload.dashboard_spec?.visuals?.[index]?.title || `Figure ${index + 1}`} />
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </section>
  );
}
