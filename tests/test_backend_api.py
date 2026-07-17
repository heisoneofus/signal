from __future__ import annotations

import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import create_app
from src.models import SessionState
from src.services import ApplicationService
from src.services.google_sheets import GoogleSheetCsv, GoogleWorksheet, GoogleWorksheetsResult
from src.storage import LocalArtifactStore


def _client(tmp_path: Path) -> TestClient:
    app = create_app(root_dir=tmp_path)
    return TestClient(app)


def test_health_endpoint_does_not_initialize_heavy_service(tmp_path: Path) -> None:
    app = create_app(root_dir=tmp_path)
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert app.state.service._instance is None


def test_local_production_preview_origin_is_allowed(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.options(
        "/generate",
        headers={
            "Origin": "http://127.0.0.1:4173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:4173"


def test_auto_selected_local_preview_origin_is_allowed(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.options(
        "/generate",
        headers={
            "Origin": "http://127.0.0.1:4186",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:4186"


def test_analyze_endpoint_persists_session_and_artifacts(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/analyze",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales\nEU,10\nUS,20\n"), "text/csv")},
        data={"context_text": "Focus on regional sales trends."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("session_")
    assert payload["analysis"]["data_schema"]["region"] in {"object", "str"}
    assert payload["analysis"]["data_schema"]["sales"] == "int64"
    assert payload["dashboard_spec"]["title"]
    artifact_types = {artifact["type"] for artifact in payload["artifacts"]}
    assert {"log", "state", "trace", "dashboard_spec", "source", "context"} <= artifact_types

    session_id = payload["session_id"]
    sessions = client.get("/sessions")
    assert sessions.status_code == 200
    session_payload = sessions.json()
    assert len(session_payload["items"]) == 1
    assert session_payload["items"][0]["session_id"] == session_id
    assert session_payload["items"][0]["status"] == "planned"

    detail = client.get(f"/sessions/{session_id}")
    assert detail.status_code == 200
    detail_payload = detail.json()
    assert detail_payload["session_id"] == session_id
    assert detail_payload["dashboard_spec"]["title"] == payload["dashboard_spec"]["title"]
    assert detail_payload["figures"] == []

    artifact = client.get(f"/artifacts/{session_id}/dashboard_spec")
    assert artifact.status_code == 200
    spec_payload = json.loads(artifact.text)
    assert spec_payload["title"] == payload["dashboard_spec"]["title"]


def test_artifact_endpoint_rejects_unknown_artifact_types(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.get("/artifacts/session_20260404_000000/unknown")

    assert response.status_code == 404
    assert response.json()["code"] == "artifact_not_found"


def test_generate_and_update_endpoints_return_plotly_json(tmp_path: Path) -> None:
    client = _client(tmp_path)

    generate = client.post(
        "/generate",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales,profit\nEU,10,4\nUS,20,9\nAPAC,15,5\n"), "text/csv")},
        data={"context_text": "Show sales and profit by region."},
    )

    assert generate.status_code == 200
    generated = generate.json()
    assert generated["session_id"].startswith("session_")
    assert generated["session_status"] in {"reviewed", "repaired", "executed"}
    assert generated["figures"]
    assert "data" in generated["figures"][0]
    assert "layout" in generated["figures"][0]
    generated_artifacts = {artifact["type"] for artifact in generated["artifacts"]}
    assert {"dashboard_spec", "figures", "state", "trace", "source"} <= generated_artifacts

    session_id = generated["session_id"]
    detail = client.get(f"/sessions/{session_id}")
    assert detail.status_code == 200
    assert detail.json()["figures"]

    update = client.post(
        "/update",
        json={"session_id": session_id, "prompt": "Change to a scatter chart and add filter for region"},
    )

    assert update.status_code == 200
    updated = update.json()
    assert updated["session_id"] == session_id
    assert updated["figures"]
    assert updated["changed"] is True
    assert updated["changes"]
    assert updated["warnings"] == []
    assert any(visual["chart_type"] == "scatter" for visual in updated["dashboard_spec"]["visuals"])
    assert "region" in updated["dashboard_spec"]["filters"]

    figures_artifact = client.get(f"/artifacts/{session_id}/figures")
    assert figures_artifact.status_code == 200
    serialized_figures = json.loads(figures_artifact.text)
    assert len(serialized_figures) == len(updated["figures"])


def test_latest_dashboard_refinement_can_be_undone(tmp_path: Path) -> None:
    client = _client(tmp_path)

    generate = client.post(
        "/generate",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales\nEU,10\nUS,20\n"), "text/csv")},
        data={"context_text": "Show sales by region."},
    )

    assert generate.status_code == 200
    generated = generate.json()
    session_id = generated["session_id"]
    original_spec = generated["dashboard_spec"]
    assert client.get(f"/sessions/{session_id}").json()["revision_count"] == 1

    update = client.post(
        "/update",
        json={"session_id": session_id, "prompt": "Switch to dark theme"},
    )

    assert update.status_code == 200
    updated = update.json()
    assert updated["revision_count"] == 2
    assert updated["dashboard_spec"]["theme"] == "dark"

    undo = client.post(f"/sessions/{session_id}/undo")

    assert undo.status_code == 200
    restored = undo.json()
    assert restored["revision_count"] == 1
    assert restored["dashboard_spec"] == original_spec
    assert restored["figures"]
    assert client.get(f"/sessions/{session_id}").json()["dashboard_spec"] == original_spec

    unavailable = client.post(f"/sessions/{session_id}/undo")
    assert unavailable.status_code == 409
    assert unavailable.json()["code"] == "revision_not_available"


def test_unsupported_dashboard_refinement_does_not_create_fake_revision(tmp_path: Path) -> None:
    client = _client(tmp_path)

    generated = client.post(
        "/generate",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales\nEU,10\nUS,20\n"), "text/csv")},
        data={"context_text": "Show sales by region."},
    ).json()
    session_id = generated["session_id"]

    update = client.post(
        "/update",
        json={"session_id": session_id, "prompt": "Make the dashboard more insightful"},
    )

    assert update.status_code == 200
    unchanged = update.json()
    assert unchanged["changed"] is False
    assert unchanged["changes"] == []
    assert unchanged["revision_count"] == 1
    assert unchanged["dashboard_spec"] == generated["dashboard_spec"]
    assert "No structured patch operation" in unchanged["warnings"][0]
    assert client.get(f"/sessions/{session_id}").json()["revision_count"] == 1

    already_current = client.post(
        "/update",
        json={"session_id": session_id, "prompt": f"Use {generated['dashboard_spec']['layout']} layout"},
    ).json()
    assert already_current["changed"] is False
    assert already_current["changes"] == []
    assert already_current["revision_count"] == 1
    assert "matched the current dashboard" in already_current["warnings"][0]
    assert client.post(f"/sessions/{session_id}/undo").status_code == 409


def test_session_detail_includes_dataset_profile_and_filter_options(tmp_path: Path) -> None:
    client = _client(tmp_path)

    generate = client.post(
        "/generate",
        files={
            "dataset": (
                "sales.csv",
                io.BytesIO(b"region,segment,sales\nEU,Enterprise,10\nUS,SMB,20\nEU,SMB,\nEU,Enterprise,10\n"),
                "text/csv",
            )
        },
        data={"context_text": "Show sales by region and segment."},
    )

    assert generate.status_code == 200
    session_id = generate.json()["session_id"]

    detail = client.get(f"/sessions/{session_id}")

    assert detail.status_code == 200
    profile = detail.json()["dataset_profile"]
    assert profile["row_count"] == 4
    assert profile["column_count"] == 3
    assert profile["missing_cells"] == 1
    assert profile["duplicate_rows"] == 1
    assert 0 <= profile["quality_score"] <= 100
    assert "region" in profile["filter_options"]
    assert profile["filter_options"]["region"] == ["EU", "US"]


def test_session_patch_persists_title_and_visual_order(tmp_path: Path) -> None:
    client = _client(tmp_path)

    generate = client.post(
        "/generate",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales,profit\nEU,10,4\nUS,20,9\nAPAC,15,5\n"), "text/csv")},
        data={"context_text": "Show sales and profit by region."},
    )

    assert generate.status_code == 200
    generated = generate.json()
    session_id = generated["session_id"]
    visual_ids = [visual["id"] for visual in generated["dashboard_spec"]["visuals"]]
    assert len(visual_ids) >= 2

    patch = client.patch(
        f"/sessions/{session_id}",
        json={"title": "Renamed Sales Dashboard", "visual_order": list(reversed(visual_ids))},
    )

    assert patch.status_code == 200
    patched = patch.json()
    assert patched["dashboard_spec"]["title"] == "Renamed Sales Dashboard"
    assert [visual["id"] for visual in patched["dashboard_spec"]["visuals"]] == list(reversed(visual_ids))

    detail = client.get(f"/sessions/{session_id}")
    assert detail.status_code == 200
    assert detail.json()["dashboard_spec"]["title"] == "Renamed Sales Dashboard"


def test_session_figures_endpoint_rerenders_with_filters(tmp_path: Path) -> None:
    client = _client(tmp_path)

    generate = client.post(
        "/generate",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales\nEU,10\nUS,20\nEU,15\n"), "text/csv")},
        data={"context_text": "Show sales by region."},
    )

    assert generate.status_code == 200
    session_id = generate.json()["session_id"]

    response = client.post(f"/sessions/{session_id}/figures", json={"filters": {"region": ["EU"]}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == session_id
    assert payload["figures"]
    first_figure_text = json.dumps(payload["figures"][0])
    assert "EU" in first_figure_text
    assert "US" not in first_figure_text


def test_session_generate_finalizes_planned_session_and_creates_figures(tmp_path: Path) -> None:
    client = _client(tmp_path)

    analyze = client.post(
        "/analyze",
        files={"dataset": ("sales.csv", io.BytesIO(b"region,sales\nEU,10\nUS,20\n"), "text/csv")},
        data={"context_text": "Show sales by region."},
    )

    assert analyze.status_code == 200
    session_id = analyze.json()["session_id"]
    assert client.get(f"/sessions/{session_id}").json()["figures"] == []

    response = client.post(f"/sessions/{session_id}/generate")

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == session_id
    assert payload["session_status"] == "reviewed"
    assert payload["figures"]
    assert all(visual["status"] == "rendered" for visual in payload["dashboard_spec"]["visuals"])


def test_vercel_api_prefix_accepts_direct_generate_upload(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/generate",
        files={"dataset": ("support.csv", io.BytesIO(b"date,tickets\n2026-04-01,42\n2026-04-02,51\n"), "text/csv")},
        data={"context_text": "Show ticket volume over time."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("session_")
    assert payload["figures"]
    assert payload["dashboard_spec"]["visuals"]


def test_generate_endpoint_with_heuristic_time_series_does_not_invalid_pivot(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_ADMIN_KEY", raising=False)
    client = _client(tmp_path)

    response = client.post(
        "/generate",
        files={
            "dataset": (
                "support_timeseries.csv",
                io.BytesIO(
                    b"date,channel,severity,tickets_created,backlog_open\n"
                    b"2026-03-01,email,normal,42,118\n"
                    b"2026-03-01,chat,normal,68,37\n"
                    b"2026-03-02,email,normal,47,120\n"
                    b"2026-03-02,chat,high,73,41\n"
                ),
                "text/csv",
            )
        },
        data={"context_text": "Build a support operations dashboard."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["figures"]
    assert all(visual["x"] != visual["y"] for visual in payload["dashboard_spec"]["visuals"] if visual["chart_type"] == "heatmap")


def test_vercel_nested_api_entrypoints_cover_frontend_routes() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    entrypoints = [
        repo_root / "api" / "[...path].py",
        repo_root / "api" / "analyze" / "[mode].py",
        repo_root / "api" / "artifacts" / "[session_id]" / "[artifact_type].py",
        repo_root / "api" / "generate" / "[mode].py",
        repo_root / "api" / "sessions" / "[session_id].py",
        repo_root / "api" / "sessions" / "[session_id]" / "figures.py",
        repo_root / "api" / "sessions" / "[session_id]" / "generate.py",
    ]

    for entrypoint in entrypoints:
        assert entrypoint.read_text(encoding="utf-8").strip() == "from backend.main import app"


def test_generate_stored_endpoint_processes_preuploaded_dataset(tmp_path: Path) -> None:
    app = create_app(root_dir=tmp_path)
    app.state.service.artifact_store.write_bytes(
        "uploads/sales.csv",
        b"region,sales,profit\nEU,10,4\nUS,20,9\n",
        content_type="text/csv",
    )
    client = TestClient(app)

    response = client.post(
        "/generate/stored",
        json={
            "dataset_key": "uploads/sales.csv",
            "filename": "sales.csv",
            "context_text": "Show sales and profit by region.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("session_")
    assert payload["figures"]
    assert payload["dashboard_spec"]["title"]


def test_google_sheets_worksheets_endpoint_lists_tabs(tmp_path: Path, monkeypatch) -> None:
    class StubGoogleSheetsClient:
        def list_worksheets(self, spreadsheet_url_or_id: str, *, access_token: str | None = None) -> GoogleWorksheetsResult:
            assert spreadsheet_url_or_id == "https://docs.google.com/spreadsheets/d/sheet123/edit"
            assert access_token == "token-123"
            return GoogleWorksheetsResult(
                spreadsheet_id="sheet123",
                title="Revenue Ops",
                worksheets=[
                    GoogleWorksheet(sheet_id=101, title="Q1 Sales", index=0, row_count=12, column_count=3),
                    GoogleWorksheet(sheet_id=202, title="Q2 Sales", index=1, row_count=8, column_count=3),
                ],
            )

    monkeypatch.setattr("src.services.application.GoogleSheetsClient", StubGoogleSheetsClient)
    client = _client(tmp_path)

    response = client.post(
        "/google-sheets/worksheets",
        json={
            "spreadsheet_url": "https://docs.google.com/spreadsheets/d/sheet123/edit",
            "access_token": "token-123",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["spreadsheet_id"] == "sheet123"
    assert payload["title"] == "Revenue Ops"
    assert payload["worksheets"][0] == {
        "sheet_id": 101,
        "title": "Q1 Sales",
        "index": 0,
        "row_count": 12,
        "column_count": 3,
    }


def test_generate_google_sheets_endpoint_materializes_selected_sheet(tmp_path: Path, monkeypatch) -> None:
    class StubGoogleSheetsClient:
        def fetch_sheet_csv(
            self,
            spreadsheet_url_or_id: str,
            *,
            worksheet_id: int | None = None,
            worksheet_name: str | None = None,
            access_token: str | None = None,
        ) -> GoogleSheetCsv:
            assert spreadsheet_url_or_id == "sheet123"
            assert worksheet_id == 101
            assert worksheet_name is None
            assert access_token is None
            return GoogleSheetCsv(
                spreadsheet_id="sheet123",
                spreadsheet_title="Revenue Ops",
                worksheet_id=101,
                worksheet_title="Q1 Sales",
                filename="Revenue-Ops-Q1-Sales.csv",
                content=b"region,sales,profit\nEU,10,4\nUS,20,9\n",
            )

    monkeypatch.setattr("src.services.application.GoogleSheetsClient", StubGoogleSheetsClient)
    client = _client(tmp_path)

    response = client.post(
        "/generate/google-sheets",
        json={
            "spreadsheet_id": "sheet123",
            "worksheet_id": 101,
            "context_text": "Show sales and profit by region.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("session_")
    assert payload["figures"]
    artifact_types = {artifact["type"] for artifact in payload["artifacts"]}
    assert "source" in artifact_types

    source = client.get(f"/artifacts/{payload['session_id']}/source")
    assert source.status_code == 200
    assert "region,sales,profit" in source.text


def test_remote_artifact_listing_skips_absent_transformed_dataset(tmp_path: Path) -> None:
    class RecordingRemoteStore:
        is_remote = True

        def __init__(self) -> None:
            self.exists_calls: list[str] = []

        def exists(self, key: str) -> bool:
            self.exists_calls.append(key)
            return False

        def list_keys(self, prefix: str) -> list[str]:
            return []

        def location(self, key: str) -> str:
            return key

    service = ApplicationService(root_dir=tmp_path)
    store = RecordingRemoteStore()
    service.artifact_store = store  # type: ignore[assignment]
    service.remote_artifacts_enabled = True

    service.list_artifacts("session_20260618_000000", state=SessionState(session_id="session_20260618_000000"))

    assert "outputs/transformed_session_20260618_000000.parquet" not in store.exists_calls


def test_remote_session_list_uses_lightweight_limited_state_hydration(tmp_path: Path) -> None:
    class TrackingRemoteStore(LocalArtifactStore):
        is_remote = True

        def __init__(self, root_dir: Path) -> None:
            super().__init__(root_dir=root_dir)
            self.materialized_keys: list[str] = []

        def materialize(self, key: str, *, destination: Path | None = None) -> Path:
            self.materialized_keys.append(key)
            return super().materialize(key, destination=destination)

    remote_root = tmp_path / "remote"
    remote_logs = remote_root / "logs"
    remote_outputs = remote_root / "outputs"
    remote_logs.mkdir(parents=True)
    remote_outputs.mkdir(parents=True)

    for day in (21, 22, 23):
        session_id = f"session_202606{day:02d}_063000_000000"
        state = SessionState(
            session_id=session_id,
            status="reviewed",
            created_at=f"2026-06-{day:02d}T06:30:00+00:00",
            updated_at=f"2026-06-{day:02d}T06:31:00+00:00",
        )
        state.active_spec.title = f"Session {day}"
        (remote_logs / f"{session_id}.state.json").write_text(state.model_dump_json(), encoding="utf-8")
        (remote_outputs / f"source_{session_id}.csv").write_text("value\n1\n", encoding="utf-8")

    service = ApplicationService(root_dir=tmp_path / "app")
    store = TrackingRemoteStore(root_dir=remote_root)
    service.artifact_store = store
    service.remote_artifacts_enabled = True

    sessions = service.list_sessions(limit=2)

    assert [session.session_id for session in sessions] == [
        "session_20260623_063000_000000",
        "session_20260622_063000_000000",
    ]
    assert store.materialized_keys == [
        "logs/session_20260623_063000_000000.state.json",
        "logs/session_20260622_063000_000000.state.json",
    ]


def test_remote_session_hydration_refreshes_mutable_cached_artifacts(tmp_path: Path) -> None:
    class TrackingRemoteStore(LocalArtifactStore):
        is_remote = True

        def __init__(self, root_dir: Path) -> None:
            super().__init__(root_dir=root_dir)
            self.materialized_keys: list[str] = []

        def materialize(self, key: str, *, destination: Path | None = None) -> Path:
            self.materialized_keys.append(key)
            return super().materialize(key, destination=destination)

    session_id = "session_20260714_170000_000000"
    remote_root = tmp_path / "remote"
    local_root = tmp_path / "app"
    remote_state_path = remote_root / "logs" / f"{session_id}.state.json"
    local_state_path = local_root / "logs" / f"{session_id}.state.json"
    remote_state_path.parent.mkdir(parents=True)
    local_state_path.parent.mkdir(parents=True)

    remote_state = SessionState(session_id=session_id)
    remote_state.active_spec.title = "Remote revision"
    remote_state_path.write_text(remote_state.model_dump_json(), encoding="utf-8")

    stale_local_state = SessionState(session_id=session_id)
    stale_local_state.active_spec.title = "Stale local revision"
    local_state_path.write_text(stale_local_state.model_dump_json(), encoding="utf-8")

    service = ApplicationService(root_dir=local_root)
    store = TrackingRemoteStore(root_dir=remote_root)
    service.artifact_store = store
    service.remote_artifacts_enabled = True

    service._hydrate_remote_session(session_id)

    refreshed_state = SessionState.model_validate_json(local_state_path.read_text(encoding="utf-8"))
    assert refreshed_state.active_spec.title == "Remote revision"
    assert store.materialized_keys == [f"logs/{session_id}.state.json"]
