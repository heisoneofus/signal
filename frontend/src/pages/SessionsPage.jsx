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
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;

    async function loadSessions() {
      setLoading(true);
      setError("");
      try {
        const payload = await fetchSessions(100);
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
    return [...items].sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned)) {
        return left.pinned ? -1 : 1;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return sortedItems;
    }
    return sortedItems.filter((item) => {
      const searchable = [item.title, item.session_id, item.status, formatCreatedAt(item.created_at)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [query, sortedItems]);

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

  async function togglePinned(item) {
    setSaving(true);
    setError("");
    try {
      const detail = await patchSession(item.session_id, { pinned: !item.pinned });
      setItems((current) =>
        current.map((candidate) =>
          candidate.session_id === item.session_id ? { ...candidate, pinned: detail.pinned } : candidate,
        ),
      );
    } catch (saveError) {
      setError(saveError.message || "Unable to update this dashboard pin.");
    } finally {
      setSaving(false);
    }
  }

  const pinnedCount = items.filter((item) => item.pinned).length;

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Sessions</p>
          <h1>Dashboard Sessions</h1>
        </div>
        <Link className="button button--primary" to="/upload">
          New run
        </Link>
      </div>

      {loading ? <p className="status">Loading sessions...</p> : null}
      {error ? <p className="status status--error">{error}</p> : null}
      {!loading && !error && !sortedItems.length ? <p className="status">No sessions have been recorded yet.</p> : null}

      {!loading && !error && sortedItems.length ? (
        <div className="session-search" role="search">
          <label htmlFor="session-search-input">
            <span>Find a dashboard</span>
            <input
              id="session-search-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, date, or session ID"
              type="search"
              value={query}
            />
          </label>
          <p aria-live="polite">
            {query.trim() ? `${filteredItems.length} of ${sortedItems.length} sessions` : `${sortedItems.length} saved sessions`}
            {pinnedCount ? ` · ${pinnedCount} pinned` : ""}
          </p>
        </div>
      ) : null}

      {!loading && !error && sortedItems.length && !filteredItems.length ? (
        <div className="session-search-empty">
          <p>No dashboards match “{query.trim()}”.</p>
          <button className="button button--ghost" onClick={() => setQuery("")} type="button">
            Clear search
          </button>
        </div>
      ) : null}

      <div className="session-list">
        {filteredItems.map((item) => (
          <article className={`session-card${item.pinned ? " session-card--pinned" : ""}`} key={item.session_id}>
            <div>
              <div className="session-card__signals">
                <p className="session-card__status">{item.status}</p>
                {item.pinned ? <p className="session-card__pin-label">Pinned dashboard</p> : null}
              </div>
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
              <button
                aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`}
                aria-pressed={Boolean(item.pinned)}
                className={`button button--ghost session-pin${item.pinned ? " session-pin--active" : ""}`}
                disabled={saving}
                onClick={() => togglePinned(item)}
                type="button"
              >
                {item.pinned ? "Pinned" : "Pin"}
              </button>
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
