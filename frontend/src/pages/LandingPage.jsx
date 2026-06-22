import React from "react";
import { Link } from "react-router-dom";

import { Icon } from "../components/Icons";

export function LandingPage() {
  return (
    <main className="landing-page">
      <div className="landing-gradient-wave" data-testid="landing-gradient-wave" aria-hidden="true" />
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="signal-pill">
          <Icon name="signal" size={16} />
          <span>Signal Intelligence</span>
          <span className="live-dot" />
        </div>

        <h1 id="landing-title">
          <span>Upload your data. </span>
          <span className="gradient-text">Get a dashboard with reasoning.</span>
        </h1>

        <p className="landing-copy">
          An intelligent analyst that cleans, transforms, and interprets raw datasets, building dashboards
          automatically with full transparency into its thinking.
        </p>

        <div className="landing-actions">
          <Link className="button button--primary button--large" to="/upload">
            <Icon name="upload" size={18} />
            Upload CSV
          </Link>
          <button className="button button--secondary button--large" type="button" disabled>
            <Icon name="database" size={18} />
            Connect Sheets
          </button>
        </div>

        <div className="terminal-strip" aria-hidden="true">
          <span>[SYS] init_transformation_pipeline</span>
          <span>0x4A2F</span>
        </div>
      </section>
    </main>
  );
}
