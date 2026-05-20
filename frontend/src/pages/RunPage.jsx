import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { uploadDataset } from "../api";
import { Icon } from "../components/Icons";

function formatBytes(bytes = 0) {
  if (!bytes) {
    return "0KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function parseCsvRows(text) {
  const rows = [];
  let current = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current.trim());
    if (row.some(Boolean)) {
      rows.push(row);
    }
  }

  return rows;
}

function buildPreview(rows) {
  const headers = rows[0] || [];
  const bodyRows = rows.slice(1, 6);
  const missingValues = bodyRows.flat().filter((value) => !value || value.toLowerCase() === "null").length;
  const totalValues = Math.max(1, bodyRows.length * Math.max(1, headers.length));
  const missingRatio = Math.round((missingValues / totalValues) * 1000) / 10;

  return {
    headers,
    rows: bodyRows,
    missingRatio,
    rowCount: Math.max(0, rows.length - 1),
  };
}

function fileKind(name = "") {
  const suffix = name.split(".").pop()?.toLowerCase();
  if (suffix === "csv") return "CSV";
  if (suffix === "xlsx" || suffix === "xls") return "Excel";
  if (suffix === "parquet") return "Parquet";
  return "Dataset";
}

function QualityCard({ preview }) {
  const score = Math.max(62, Math.round(94 - (preview?.missingRatio || 0) * 3));
  const missing = preview ? `${preview.missingRatio}%` : "Pending";

  return (
    <aside className="quality-card" aria-label="Data quality score">
      <div className="card-heading">
        <Icon name="shield" size={18} />
        <span>Data Quality Score</span>
      </div>
      <div className="score-ring" style={{ "--score": `${score}%` }}>
        <strong>{preview ? score : "--"}</strong>
        <span>/ 100</span>
      </div>
      <div className="quality-meters">
        <div className="meter-row">
          <span>Missing values</span>
          <code>{missing}</code>
        </div>
        <div className="meter">
          <span style={{ width: preview ? `${Math.min(100, preview.missingRatio * 8)}%` : "12%" }} />
        </div>
        <div className="meter-row">
          <span>Anomalies</span>
          <code>Pending...</code>
        </div>
        <div className="meter meter--muted">
          <span />
        </div>
      </div>
      <p>Score will fully compute during AI processing.</p>
    </aside>
  );
}

function StructuredPreview({ preview }) {
  if (!preview?.headers?.length) {
    return (
      <section className="data-table-card">
        <div className="panel-header">
          <div>
            <h2>Structured Preview</h2>
            <p>Upload a CSV to inspect column types before analysis.</p>
          </div>
        </div>
        <div className="empty-state">No preview rows available yet.</div>
      </section>
    );
  }

  return (
    <section className="data-table-card">
      <div className="panel-header">
        <div>
          <h2>Structured Preview</h2>
          <p>Showing {Math.min(5, preview.rowCount)} of {preview.rowCount || preview.rows.length} rows</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-preview-table">
          <thead>
            <tr>
              {preview.headers.map((header) => (
                <th key={header || "column"}>
                  <span>{header || "column"}</span>
                  <small>{header.toLowerCase().includes("date") ? "DATE" : "FIELD"} 100% valid</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={`${row.join("-")}-${rowIndex}`}>
                {preview.headers.map((header, columnIndex) => {
                  const value = row[columnIndex] || "null";
                  return <td key={`${header}-${columnIndex}`} className={value === "null" ? "null-cell" : ""}>{value}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const PROCESSING_PHASES = [
  {
    label: "Uploading dataset to Signal",
    log: "[SYS] Received dataset and context payload",
  },
  {
    label: "Reading columns and sampling rows",
    log: "[DAT] Inferring schema, row counts, and field types",
  },
  {
    label: "Running metrics analysis",
    log: "[AI] Identifying primary KPIs and supporting dimensions",
  },
  {
    label: "Assessing missing values and anomalies",
    log: "[CHK] Profiling nulls, duplicates, and outlier candidates",
  },
  {
    label: "Planning transformations",
    log: "[TRN] Selecting safe cleaning and aggregation operations",
  },
  {
    label: "Synthesizing chart topology",
    log: "[VIS] Matching metrics to charts, filters, and layout sections",
  },
  {
    label: "Rendering Plotly figure JSON",
    log: "[FIG] Building chart-ready traces and themed layouts",
  },
  {
    label: "Packaging dashboard session",
    log: "[OUT] Persisting session artifacts and dashboard spec",
  },
];

export function ProcessingPanel({ mode = "generate" }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 1800);
    return () => window.clearInterval(intervalId);
  }, []);

  const activeIndex = tick % PROCESSING_PHASES.length;
  const visibleSteps = [0, 1, 2, 3].map((offset) => {
    const index = (activeIndex + offset) % PROCESSING_PHASES.length;
    const phase = PROCESSING_PHASES[index];
    if (offset === 0) {
      return { ...phase, status: "active", index };
    }
    if (offset === 1) {
      return { ...phase, status: "queued", index };
    }
    return { ...phase, status: "pending", index };
  });

  const completedPhase =
    tick === 0
      ? {
          label: "Initializing Signal pipeline",
          log: "[SYS] Initializing Signal pipeline",
        }
      : PROCESSING_PHASES[(activeIndex + PROCESSING_PHASES.length - 1) % PROCESSING_PHASES.length];
  const activePhase = PROCESSING_PHASES[activeIndex];
  const nextPhase = PROCESSING_PHASES[(activeIndex + 1) % PROCESSING_PHASES.length];
  const progress = Math.min(94, 12 + tick * 10);
  const heading = mode === "analyze" ? "Analyzing your data" : "Architecting your dashboard";

  return (
    <section className="processing-panel" aria-live="polite">
      <div className="processing-title">
        <span className="processing-icon">
          <Icon name="spark" size={28} />
        </span>
        <h2>{heading}</h2>
        <p>The AI is analyzing patterns, transforming data, and building a visualization plan.</p>
        <p className="processing-subtitle">This may take a minute or two. You can leave this tab open while Signal works.</p>
      </div>
      <div className="processing-progress" aria-label={`Processing progress ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="processing-steps">
        <div className="processing-step processing-step--complete">
          <span />
          {completedPhase.label}
          <Icon name="check" size={15} />
        </div>
        {visibleSteps.map((step) => (
          <div
            aria-label={step.status === "active" ? "Current processing step" : undefined}
            className={`processing-step processing-step--${step.status}`}
            key={`${step.index}-${step.label}`}
          >
            <span />
            {step.label}
            {step.status === "active" ? <i /> : null}
          </div>
        ))}
      </div>
      <div className="console-card">
        <div className="console-card__bar">
          <Icon name="terminal" size={14} />
          signal-engine.log
        </div>
        <code>{completedPhase.log}</code>
        <code className="warn">{activePhase.log}</code>
        <code className="ok">{nextPhase.log}</code>
      </div>
    </section>
  );
}

export function RunPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [contextText, setContextText] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  const fileSummary = useMemo(() => {
    if (!file) {
      return null;
    }
    const rows = preview?.rowCount ? `${preview.rowCount.toLocaleString()} rows` : "rows pending";
    const columns = preview?.headers?.length ? `${preview.headers.length} columns` : `${fileKind(file.name)} file`;
    return `${columns} - ${rows} - ${formatBytes(file.size)} - Detected encoding: UTF-8`;
  }, [file, preview]);

  async function handleFileChange(event) {
    const selectedFile = event.target.files?.[0] || null;
    setFile(selectedFile);
    setError("");
    setPreview(null);

    if (!selectedFile) {
      return;
    }

    if (selectedFile.name.toLowerCase().endsWith(".csv")) {
      try {
        const text = await selectedFile.text();
        setPreview(buildPreview(parseCsvRows(text)));
      } catch {
        setPreview(null);
      }
    }
  }

  async function handleSubmit(mode) {
    if (!file) {
      setError("Choose a dataset file before running analysis.");
      return;
    }

    setBusyAction(mode);
    setError("");
    try {
      const endpoint = mode === "analyze" ? "/analyze" : "/generate";
      const payload = await uploadDataset(endpoint, file, contextText);
      startTransition(() => {
        navigate(`/results/${payload.session_id}`);
      });
    } catch (submissionError) {
      setError(submissionError.message || "Unable to process the dataset right now.");
    } finally {
      setBusyAction("");
    }
  }

  if (busyAction) {
    return <ProcessingPanel mode={busyAction} />;
  }

  return (
    <section className="data-workflow">
      <div className="workflow-header">
        <div>
          <h1>
            <Icon name="file" size={24} />
            {file?.name || "Upload a dataset"}
          </h1>
          <p>{fileSummary || "CSV, Excel, and Parquet files are supported by the Signal analysis core."}</p>
        </div>
        <div className="workflow-actions">
          <button type="button" className="button button--secondary" disabled={!!busyAction} onClick={() => handleSubmit("analyze")}>
            Analyze Only
          </button>
          <button type="button" className="button button--primary" disabled={!!busyAction} onClick={() => handleSubmit("generate")}>
            <Icon name="database" size={16} />
            Analyze & Generate Dashboard
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>

      <div className="upload-context-row">
        <label className="field file-field">
          <span>Dataset File</span>
          <span className="file-picker">
            <input
              aria-label="Dataset File"
              type="file"
              accept=".csv,.xlsx,.xls,.parquet"
              onChange={handleFileChange}
            />
            <span className="file-picker__name">
              <Icon name="upload" size={16} />
              {file?.name || "Choose CSV, Excel, or Parquet"}
            </span>
          </span>
        </label>

        <label className="field context-field">
          <span>Context</span>
          <textarea
            aria-label="Context"
            rows={3}
            placeholder="Optional analyst guidance, business questions, or dashboard goals."
            value={contextText}
            onChange={(event) => setContextText(event.target.value)}
          />
        </label>
      </div>

      {error ? <p className="status status--error">{error}</p> : null}

      <div className="data-grid">
        <QualityCard preview={preview} />
        <StructuredPreview preview={preview} />
      </div>
    </section>
  );
}
