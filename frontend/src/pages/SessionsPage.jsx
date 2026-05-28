import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchSessions, patchSession } from "../api";

function formatCreatedAt(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value ? `Created ${value}` : "Created date unavailable";
  }
  return `Created ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export function SessionsPage() {
  const [items, setItems] = useState([]);
  const [editingSessionId, setEditingSessionId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSessions() {
      setLoading(true);
      setError("");
      try {
        const payload = await fetchSessions();
        if (active) {
          setItems(payload.items || []);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Unable to load sessions.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadSessions();
    return () => {
      active = false;
    };
  }, []);

  const sortedItems = useMemo(() => {
    return [...items].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }, [items]);

  function startRename(item) {
    setEditingSessionId(item.session_id);
    setDraftTitle(item.title || "");
  }

  async function saveRename(sessionId) {
    if (!draftTitle.trim()) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const detail = await patchSession(sessionId, { title: draftTitle.trim() });
      const nextTitle = detail.dashboard_spec?.title || draftTitle.trim();
      setItems((current) =>
        current.map((item) => (item.session_id === sessionId ? { ...item, title: nextTitle } : item)),
      );
      setEditingSessionId("");
      setDraftTitle("");
    } catch (saveError) {
      setError(saveError.message || "Unable to rename this dashboard.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Sessions</p>
          <h2>Previous runs</h2>
        </div>
        <Link className="button button--primary" to="/upload">
          New run
        </Link>
      </div>

      {loading ? <p className="status">Loading sessions...</p> : null}
      {error ? <p className="status status--error">{error}</p> : null}
      {!loading && !error && !sortedItems.length ? <p className="status">No sessions have been recorded yet.</p> : null}

      <div className="session-list">
        {sortedItems.map((item) => (
          <article className="session-card" key={item.session_id}>
            <div>
              <p className="session-card__status">{item.status}</p>
              {editingSessionId === item.session_id ? (
                <label className="field field--inline-edit">
                  <span>Dashboard Name</span>
                  <input
                    aria-label="Dashboard Name"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                </label>
              ) : (
                <h3>{item.title}</h3>
              )}
              <p className="session-card__meta">{formatCreatedAt(item.created_at)} - {item.session_id}</p>
            </div>
            <div className="session-card__actions">
              {editingSessionId === item.session_id ? (
                <button className="button button--secondary" disabled={saving} onClick={() => saveRename(item.session_id)} type="button">
                  Save Dashboard Name
                </button>
              ) : (
                <button className="button button--ghost" onClick={() => startRename(item)} type="button" aria-label={`Rename ${item.title}`}>
                  Rename
                </button>
              )}
              <Link className="button button--ghost" to={`/results/${item.session_id}`}>
                Inspect
              </Link>
              <Link className="button button--secondary" to={`/update/${item.session_id}`}>
                Review
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
