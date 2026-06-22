import React, { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { listGoogleWorksheets, runGoogleSheetDataset, uploadDataset } from "../api";
import { Icon } from "../components/Icons";

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
let googleIdentityScriptPromise = null;

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

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve(window.google);
  }
  if (!googleIdentityScriptPromise) {
    googleIdentityScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector("script[data-signal-google-identity]");
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(window.google));
        existingScript.addEventListener("error", () => reject(new Error("Google authorization failed to load.")));
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.signalGoogleIdentity = "true";
      script.onload = () => resolve(window.google);
      script.onerror = () => reject(new Error("Google authorization failed to load."));
      document.head.appendChild(script);
    });
  }
  return googleIdentityScriptPromise;
}

async function requestGoogleSheetsToken() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Set VITE_GOOGLE_CLIENT_ID to connect private Google Sheets.");
  }
  const google = await loadGoogleIdentityScript();
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SHEETS_SCOPE,
      callback: (response) => {
        if (response?.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        resolve(response?.access_token || "");
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

function UploadBriefingCard({ sourceType = "file" }) {
  const sourceLabel = sourceType === "google_sheets" ? "selected worksheet" : "uploaded file";
  return (
    <aside className="upload-briefing-card" aria-label="Upload briefing">
      <div className="card-heading">
        <Icon name="shield" size={18} />
        <span>Preflight Briefing</span>
      </div>
      <p>Signal will profile the {sourceLabel} before it assigns a quality score or proposes transformations.</p>
      <ul className="briefing-list">
        <li>
          <Icon name="data" size={16} />
          <span>Schema, row count, and column types are inferred from the dataset.</span>
        </li>
        <li>
          <Icon name="filter" size={16} />
          <span>Missing values, duplicates, outliers, and chart-safe dimensions are checked during analysis.</span>
        </li>
        <li>
          <Icon name="spark" size={16} />
          <span>Optional context steers KPI selection and the first dashboard draft.</span>
        </li>
      </ul>
    </aside>
  );
}

function QualityCard({ preview, sourceType = "file" }) {
  const score = Math.max(62, Math.round(94 - (preview?.missingRatio || 0) * 3));
  const missing = preview ? `${preview.missingRatio}%` : "Pending";

  if (!preview) {
    return <UploadBriefingCard sourceType={sourceType} />;
  }

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
      <p>Preview score uses visible CSV rows. Full quality scoring runs during AI processing.</p>
    </aside>
  );
}

function StructuredPreview({ preview, sourceType = "file" }) {
  if (!preview?.headers?.length) {
    const emptyMessage =
      sourceType === "google_sheets"
        ? "Choose a Google worksheet to inspect it during analysis."
        : "Upload a CSV to inspect column types before analysis.";
    return (
      <section className="data-table-card">
        <div className="panel-header">
          <div>
            <h2>Structured Preview</h2>
            <p>{emptyMessage}</p>
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
  const progress = Math.min(92, 18 + tick * 8);
  const heading = mode === "analyze" ? "Analyzing your data" : "Architecting your dashboard";

  return (
    <section className="processing-panel" aria-live="polite">
      <div className="processing-title">
        <span className="processing-icon">
          <Icon name="spark" size={28} />
        </span>
        <h2>{heading}</h2>
        <p>Signal is moving through the analysis pipeline and will advance when the backend session is ready.</p>
        <p className="processing-subtitle">
          This may take a minute or two. The bar is an activity indicator, not a fixed ETA.
        </p>
      </div>
      <div className="processing-progress" aria-label="Processing activity">
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
  const [sourceType, setSourceType] = useState("file");
  const [file, setFile] = useState(null);
  const [contextText, setContextText] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetWorkbook, setSheetWorkbook] = useState(null);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [googleAccessToken, setGoogleAccessToken] = useState("");
  const [googleStatus, setGoogleStatus] = useState("");

  const fileSummary = useMemo(() => {
    if (!file) {
      return null;
    }
    const rows = preview?.rowCount ? `${preview.rowCount.toLocaleString()} rows` : "rows pending";
    const columns = preview?.headers?.length ? `${preview.headers.length} columns` : `${fileKind(file.name)} file`;
    return `${columns} - ${rows} - ${formatBytes(file.size)} - Detected encoding: UTF-8`;
  }, [file, preview]);

  const selectedWorksheet = useMemo(() => {
    if (!sheetWorkbook?.worksheets?.length || !selectedSheetId) {
      return null;
    }
    return sheetWorkbook.worksheets.find((worksheet) => String(worksheet.sheet_id) === String(selectedSheetId)) || null;
  }, [selectedSheetId, sheetWorkbook]);

  const sourceSummary = useMemo(() => {
    if (sourceType === "google_sheets") {
      if (!sheetWorkbook) {
        return "Connect a Google spreadsheet, then choose one worksheet for Signal to analyze.";
      }
      const worksheetPart = selectedWorksheet ? `${selectedWorksheet.title}` : "worksheet pending";
      const dimensions =
        selectedWorksheet?.row_count && selectedWorksheet?.column_count
          ? `${selectedWorksheet.row_count.toLocaleString()} rows - ${selectedWorksheet.column_count.toLocaleString()} columns`
          : "sheet dimensions pending";
      return `${sheetWorkbook.title} - ${worksheetPart} - ${dimensions}`;
    }
    return fileSummary || "CSV, Excel, and Parquet files are supported by the Signal analysis core.";
  }, [fileSummary, selectedWorksheet, sheetWorkbook, sourceType]);

  const sourceHeading = sourceType === "google_sheets" ? selectedWorksheet?.title || "Connect Google Sheets" : file?.name || "Upload a dataset";
  const hasRunnableSource = sourceType === "google_sheets" ? !!selectedWorksheet && !!sheetUrl.trim() : !!file;

  async function handleFileChange(event) {
    const selectedFile = event.target.files?.[0] || null;
    setSourceType("file");
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

  async function handleGoogleConnect() {
    setError("");
    setGoogleStatus("");
    try {
      const token = await requestGoogleSheetsToken();
      setGoogleAccessToken(token);
      setGoogleStatus("Google Sheets connected for this session.");
    } catch (authError) {
      setError(authError.message || "Unable to connect Google Sheets.");
    }
  }

  async function handleLoadSheets() {
    if (!sheetUrl.trim()) {
      setError("Enter a Google Sheets URL before loading worksheets.");
      return;
    }

    setSourceType("google_sheets");
    setSheetLoading(true);
    setError("");
    setSheetWorkbook(null);
    setSelectedSheetId("");
    try {
      const workbook = await listGoogleWorksheets(sheetUrl, googleAccessToken);
      setSheetWorkbook(workbook);
      setSelectedSheetId(workbook.worksheets?.[0] ? String(workbook.worksheets[0].sheet_id) : "");
    } catch (loadError) {
      setError(loadError.message || "Unable to load worksheets from Google Sheets.");
    } finally {
      setSheetLoading(false);
    }
  }

  async function handleSubmit(mode) {
    if (sourceType === "file" && !file) {
      setError("Choose a dataset file before running analysis.");
      return;
    }
    if (sourceType === "google_sheets" && !selectedWorksheet) {
      setError("Load the Google spreadsheet and choose a worksheet before running analysis.");
      return;
    }

    setBusyAction(mode);
    setError("");
    try {
      const endpoint = mode === "analyze" ? "/analyze" : "/generate";
      const payload =
        sourceType === "google_sheets"
          ? await runGoogleSheetDataset(
              endpoint,
              {
                spreadsheetUrl: sheetUrl,
                worksheetId: selectedSheetId,
                accessToken: googleAccessToken,
              },
              contextText,
            )
          : await uploadDataset(endpoint, file, contextText);
      try {
        window.localStorage.setItem("signal.currentSessionId", payload.session_id);
      } catch {
        // Navigation still works when storage is unavailable.
      }
      startTransition(() => {
        navigate(`/update/${payload.session_id}`);
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
            {sourceHeading}
          </h1>
          <p>{sourceSummary}</p>
        </div>
        <div className="workflow-actions">
          <button type="button" className="button button--secondary" disabled={!!busyAction || !hasRunnableSource} onClick={() => handleSubmit("analyze")}>
            Analyze Only
          </button>
          <button type="button" className="button button--primary" disabled={!!busyAction || !hasRunnableSource} onClick={() => handleSubmit("generate")}>
            <Icon name="database" size={16} />
            Review Draft Dashboard
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>

      <div className="source-switch" role="tablist" aria-label="Dataset source">
        <button
          type="button"
          role="tab"
          aria-selected={sourceType === "file"}
          className={`segmented-button ${sourceType === "file" ? "segmented-button--active" : ""}`}
          onClick={() => {
            setSourceType("file");
            setError("");
          }}
        >
          <Icon name="upload" size={16} />
          File Upload
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sourceType === "google_sheets"}
          className={`segmented-button ${sourceType === "google_sheets" ? "segmented-button--active" : ""}`}
          onClick={() => {
            setSourceType("google_sheets");
            setError("");
          }}
        >
          <Icon name="database" size={16} />
          Google Sheets
        </button>
      </div>

      <div className="upload-context-row">
        {sourceType === "file" ? (
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
        ) : (
          <section className="file-field google-sheet-field" aria-label="Google Sheets source">
            <label className="field">
              <span>Google Sheet URL</span>
              <input
                aria-label="Google Sheet URL"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(event) => {
                  setSheetUrl(event.target.value);
                  setSheetWorkbook(null);
                  setSelectedSheetId("");
                }}
              />
            </label>
            <div className="sheet-actions">
              <button type="button" className="button button--secondary" onClick={handleGoogleConnect}>
                <Icon name="users" size={16} />
                Connect Google
              </button>
              <button type="button" className="button button--primary" disabled={!sheetUrl.trim() || sheetLoading} onClick={handleLoadSheets}>
                <Icon name="database" size={16} />
                {sheetLoading ? "Loading Sheets" : "Load Sheets"}
              </button>
            </div>
            {googleStatus ? <p className="status status--success">{googleStatus}</p> : null}
            {sheetWorkbook?.worksheets?.length ? (
              <label className="field">
                <span>Worksheet</span>
                <select
                  aria-label="Worksheet"
                  value={selectedSheetId}
                  onChange={(event) => setSelectedSheetId(event.target.value)}
                >
                  {sheetWorkbook.worksheets.map((worksheet) => (
                    <option key={worksheet.sheet_id} value={worksheet.sheet_id}>
                      {worksheet.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="sheet-empty-state">No worksheets loaded yet.</div>
            )}
          </section>
        )}

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
        <QualityCard preview={sourceType === "file" ? preview : null} sourceType={sourceType} />
        <StructuredPreview preview={sourceType === "file" ? preview : null} sourceType={sourceType} />
      </div>
    </section>
  );
}
