import React from "react";

import { Icon } from "../components/Icons";

const productUpdates = [
  {
    date: "2026-06-20T12:01:09+03:00",
    title: "Sessions Heading Hierarchy Polish",
    summary:
      "Refined the Dashboard Sessions page so the screen presents a clearer heading structure while preserving the existing session management flow.",
    mergeCommit: "2ce9028",
    stats: "3 files changed",
    tags: ["Sessions", "Accessibility", "E2E"],
    highlights: [
      "Corrected the sessions page heading hierarchy for clearer navigation and test stability.",
      "Extended page coverage around the sessions heading.",
      "Kept the visual treatment aligned with the existing panel spacing.",
    ],
  },
  {
    date: "2026-06-15T09:44:01+03:00",
    title: "Sessions Page Copy Clarification",
    summary:
      "Tightened the sessions page language to make the dashboard session list easier to scan and more consistent with the rest of the app.",
    mergeCommit: "bd7c026",
    stats: "1 file changed",
    tags: ["Sessions", "UX Copy"],
    highlights: [
      "Clarified the main sessions heading.",
      "Reduced ambiguity between generated dashboards and saved sessions.",
      "Kept the update scoped to the visible sessions experience.",
    ],
  },
  {
    date: "2026-06-05T09:52:08+03:00",
    title: "Production E2E Stabilization",
    summary:
      "Hardened the production dashboard workflow across the backend, frontend shell, Plotly rendering, and API tests so generated dashboards behave consistently end to end.",
    mergeCommit: "27cf2b0",
    stats: "10 files changed",
    tags: ["E2E", "Production", "Dashboard", "API"],
    highlights: [
      "Improved production API behavior for dashboard sessions.",
      "Adjusted app shell and Plotly chart handling for more reliable rendered flows.",
      "Added frontend and backend coverage around the stabilized behavior.",
    ],
  },
  {
    date: "2026-06-01T12:31:32+03:00",
    title: "Dashboard Finalization Route Fixes",
    summary:
      "Connected the review-to-results handoff more reliably by fixing finalization routes and improving figure refresh behavior after dashboard edits.",
    mergeCommit: "194cf69",
    stats: "11 files changed",
    tags: ["Review Flow", "Finalization", "API", "QA"],
    highlights: [
      "Fixed the update dashboard finalization route.",
      "Added API coverage for session figure generation and dashboard finalization.",
      "Updated review and results pages so changed dashboard specs move cleanly into final output.",
    ],
  },
  {
    date: "2026-05-29T16:29:04+03:00",
    title: "Production Dashboard QA Pass",
    summary:
      "Resolved production dashboard QA issues across the app shell, review page, results page, and backend session APIs.",
    mergeCommit: "6c7d60d",
    stats: "7 files changed",
    tags: ["Dashboard", "Production", "QA"],
    highlights: [
      "Improved the review and results page handoff for generated dashboards.",
      "Adjusted backend session behavior used by production dashboard flows.",
      "Added regression coverage for the updated production path.",
    ],
  },
  {
    date: "2026-05-20T12:20:26+03:00",
    title: "Signal Product Relaunch",
    summary:
      "Relaunched the project as Signal with the FastAPI service surface, React web app, session storage, artifact handling, generated dashboards, and updated documentation.",
    mergeCommit: "aee93ba",
    stats: "76 files changed",
    tags: ["Release", "React", "FastAPI", "Dashboards"],
    highlights: [
      "Introduced the Signal web app with upload, review, sessions, and results pages.",
      "Added backend services for generation, sessions, artifacts, and API schemas.",
      "Expanded dashboard generation, visualization tooling, documentation, and tests for the renamed product.",
    ],
  },
  {
    date: "2026-04-03T23:50:54+03:00",
    title: "Initial Test Harness and Builder Updates",
    summary:
      "Added the first project-level test setup and strengthened dashboard builder and orchestrator coverage for the early Signal foundation.",
    mergeCommit: "7229949",
    stats: "7 files changed",
    tags: ["Testing", "Builder", "Orchestrator"],
    highlights: [
      "Added initial test configuration and gitignore updates.",
      "Expanded dashboard builder coverage around generated layouts.",
      "Added orchestrator tests to protect tool planning behavior.",
    ],
  },
  {
    date: "2026-04-02T13:27:31+03:00",
    title: "Data Lineage and Specification Hardening",
    summary:
      "Enhanced dataframe lineage tracking and repaired broken specs with broad tests across analyzer, models, orchestrator, session logging, tools, transforms, and visualization.",
    mergeCommit: "69cf774",
    stats: "15 files changed",
    tags: ["Data Lineage", "Tooling", "Tests", "Visualization"],
    highlights: [
      "Improved reshape tool behavior and dataframe reference tracking.",
      "Expanded schema-backed tool and orchestration tests.",
      "Added coverage for nested transforms, session logging, and visualization generation.",
    ],
  },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return dateFormatter.format(parsed);
}

export function ProductUpdatesPage() {
  return (
    <section className="product-updates-page" aria-labelledby="product-updates-title">
      <div className="product-updates-hero">
        <div>
          <p className="eyebrow">Product Updates</p>
          <h1 id="product-updates-title">
            <Icon name="calendar" size={22} />
            Product Updates
          </h1>
          <p>
            A curated feed of shipped work from this repository's merge history, translated into product-facing release notes.
          </p>
        </div>
        <div className="product-updates-summary" aria-label="Product update summary">
          <strong>{productUpdates.length}</strong>
          <span>merge-backed updates</span>
        </div>
      </div>

      <div className="product-updates-layout">
        <aside className="product-updates-sidebar" aria-label="Release feed context">
          <div>
            <span>Coverage</span>
            <strong>Apr 2, 2026 - Jun 20, 2026</strong>
          </div>
          <div>
            <span>Source</span>
            <strong>Git merge commits</strong>
          </div>
          <div>
            <span>Order</span>
            <strong>Newest first</strong>
          </div>
        </aside>

        <div className="product-update-feed" aria-label="Product updates feed">
          {productUpdates.map((update) => (
            <article className="product-update-post" data-testid="product-update-post" key={update.mergeCommit}>
              <div className="product-update-post__meta">
                <time dateTime={update.date}>{formatDate(update.date)}</time>
                <code>merge {update.mergeCommit}</code>
              </div>

              <div className="product-update-post__body">
                <div>
                  <h2>{update.title}</h2>
                  <p>{update.summary}</p>
                </div>

                <ul className="product-update-highlights">
                  {update.highlights.map((highlight) => (
                    <li key={highlight}>
                      <Icon name="check" size={15} />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>

                <div className="product-update-post__footer">
                  <span>{update.stats}</span>
                  <ul className="product-update-tags" aria-label={`${update.title} tags`}>
                    {update.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
