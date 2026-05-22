# Signal

Signal now supports two local workflows on top of the same Python analysis core:

- `signal_cli.py` / `uv run signal` for the legacy CLI + Dash experience
- `backend/` + `frontend/` for a FastAPI + React + Plotly web stack

The analyzer, orchestrator, patcher, tool registry, and session logging system are still the source of truth. The new web app wraps those pieces instead of rewriting them.

## Stack

- Backend: FastAPI, Pydantic, Plotly JSON responses
- Frontend: Vite, React, React Router, `react-plotly.js`
- Core analytics: pandas, Plotly, existing `src/` agents/tools/session artifacts

## Quick Start

### Requirements

- Python 3.11+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv)

### Install Python Dependencies

```bash
uv sync --extra dev
```

### Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

## Run The New Web App

### Start The FastAPI Backend

```bash
uv run uvicorn backend.main:app --reload
```

Backend default URL:

```text
http://127.0.0.1:8000
```

### Start The React Frontend

```bash
cd frontend
npm run dev
```

Frontend default URL:

```text
http://127.0.0.1:5173
```

## Web Features

- `POST /analyze` uploads a dataset and returns analysis + dashboard spec
- `POST /generate` runs the full pipeline and returns dashboard spec + Plotly figures
- `POST /update` applies an update prompt to an existing session
- `GET /sessions` lists prior runs from the persisted session artifacts
- `GET /sessions/{id}` returns session metadata, analysis, spec, figures, and artifact links
- `GET /artifacts/{id}/{type}` streams stored log/spec/trace/source/context/figure/parquet artifacts

The React app includes:

- `Run` page for upload + analyze/generate
- `Results` page for schema, analysis summary, and Plotly chart rendering
- `Sessions` page for browsing previous runs
- `Update` page for prompt-based dashboard revisions

## CLI Workflow

The CLI is still available and now routes execution through the shared application service layer.

### Standard Run

```bash
uv run signal --data sample_data/sample.csv
```

### Review Only

```bash
uv run signal --data sample_data/sample.csv --review-only --output-format html
```

### Update A Prior Session

```bash
uv run signal \
  --update \
  --session logs/session_20260404_010101.log \
  --prompt "Change the first chart to a scatter plot and add a region filter"
```

## Project Structure

```text
backend/      FastAPI app, API contracts, error handling
frontend/     Vite React app
src/          analyzer, orchestrator, tools, session logging, shared services
tests/        Python unit + integration coverage
sample_data/  example datasets
```

## Testing

### Python

```bash
uv run pytest -q
```

### Frontend

```bash
cd frontend
npm test
```

### Frontend Production Build

```bash
cd frontend
npm run build
```

### Playwright E2E

Local E2E starts FastAPI and Vite automatically:

```bash
npm run test:e2e
```

Protected Vercel previews use the same suite. Provide the preview URL and the Vercel automation bypass secret:

```bash
$env:E2E_BASE_URL="https://your-preview.vercel.app"
$env:VERCEL_AUTOMATION_BYPASS_SECRET="..."
npm run test:e2e:preview
```

## Notes

- Session logs still live under `logs/`
- Generated artifacts still live under `outputs/`
- `OPENAI_API_KEY` enables LLM analysis; when it is absent, Signal runs a deterministic heuristic-only planning mode.
- Browser uploads use direct API multipart by default, then switch to Vercel Blob for production files above `VITE_STORED_UPLOAD_THRESHOLD_MB` (default `4.5`). Set `VITE_USE_STORED_UPLOADS=true` to force Blob or `false` to force direct uploads.
- The backend persists uploaded source files, context text, dashboard spec JSON, Plotly figure JSON, and transformed parquet artifacts for later session replay
- The API intentionally keeps business logic out of routes; the core execution lives in `ApplicationService`

## License

MIT
