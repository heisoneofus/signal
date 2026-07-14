from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.io as pio

from src.agents.analyzer import Analyzer
from src.agents.navigator import NavigatorAgent
from src.agents.orchestrator import Orchestrator, build_registry
from src.agents.patcher import apply_dashboard_patch, parse_update_prompt
from src.config import AppConfig, LLMConfig
from src.logging.session import SessionLogger, init_session_logger, load_dashboard_spec, load_session_metadata, load_session_state
from src.models import AnalysisReport, DashboardSpec, ExecutionTrace, SessionState
from src.services.google_sheets import GoogleSheetsClient
import src.services.artifacts as artifacts
from src.storage import ArtifactStore, create_artifact_store
from src.tools import loaders
from src.tools.visualization import create_figure, error_figure, export_dashboard


@dataclass
class AnalyzeResult:
    session_id: str
    analysis: AnalysisReport
    dashboard_spec: DashboardSpec
    artifacts: list[dict[str, str]]


@dataclass
class SessionSummary:
    session_id: str
    status: str
    title: str
    created_at: str
    updated_at: str


@dataclass
class SessionDetail:
    session_id: str
    status: str
    revision_count: int
    analysis: dict[str, Any] | None
    dashboard_spec: dict[str, Any]
    figures: list[dict[str, Any]]
    artifacts: list[dict[str, str]]
    dataset_profile: dict[str, Any]


@dataclass
class GenerateResult:
    session_id: str
    analysis: AnalysisReport | None
    dashboard_spec: DashboardSpec
    figures: list[dict[str, Any]]
    session_status: str
    artifacts: list[dict[str, str]]


@dataclass
class UpdateResult:
    session_id: str
    dashboard_spec: DashboardSpec
    figures: list[dict[str, Any]]
    session_status: str
    revision_count: int
    artifacts: list[dict[str, str]]


@dataclass
class CliRunResult:
    session_id: str
    session_log: Path
    session_state: SessionState
    analysis: AnalysisReport | None
    figures: list[dict[str, Any]]
    rendered_output: Path | None


def _read_description(path: Path | None) -> str | None:
    if path is None:
        return None
    if not path.exists():
        raise FileNotFoundError(f"Description file not found: {path}")
    return path.read_text(encoding="utf-8")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_for_analysis(data_path: Path, sample_rows: int) -> pd.DataFrame:
    loader = loaders.detect_loader(data_path)
    if loader == "read_excel":
        return loaders.read_excel(data_path, sample_rows=sample_rows)
    if loader == "read_parquet":
        return loaders.read_parquet(data_path, sample_rows=sample_rows)
    return loaders.read_csv(data_path, sample_rows=sample_rows)


def _stringify_for_parquet(value: object) -> object:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return value
    except (TypeError, ValueError):
        pass
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode("utf-8", errors="replace")
    return str(value)


def _prepare_dataframe_for_parquet(df: pd.DataFrame) -> pd.DataFrame:
    result = df.copy()
    object_columns = result.select_dtypes(include=["object", "str"]).columns
    for column in object_columns:
        non_null = result[column].dropna()
        if non_null.empty:
            continue
        inferred = pd.api.types.infer_dtype(non_null, skipna=True)
        if inferred.startswith("mixed"):
            result[column] = result[column].map(_stringify_for_parquet)
    return result


class ApplicationService:
    def __init__(self, root_dir: Path, llm_api_key: str | None = None):
        base_config = AppConfig.default(root_dir)
        if llm_api_key:
            self.config = AppConfig(
                root_dir=base_config.root_dir,
                work_dir=base_config.work_dir,
                logs_dir=base_config.logs_dir,
                outputs_dir=base_config.outputs_dir,
                llm=LLMConfig(
                    model=base_config.llm.model,
                    analysis_temperature=base_config.llm.analysis_temperature,
                    tool_temperature=base_config.llm.tool_temperature,
                    api_key=llm_api_key,
                ),
                sample_rows=base_config.sample_rows,
            )
        else:
            self.config = base_config
        self.artifact_store: ArtifactStore = create_artifact_store(self.config.work_dir)
        self.remote_artifacts_enabled = self.artifact_store.is_remote

    def _artifact_local_path_from_key(self, key: str) -> Path:
        return (self.config.work_dir / Path(key)).resolve()

    def _normalize_session_locations(
        self,
        session_state: SessionState,
        *,
        source_path: Path | None = None,
        context_path: Path | None = None,
        transformed_path: Path | None = None,
    ) -> None:
        if not self.remote_artifacts_enabled:
            return
        if source_path is not None:
            session_state.data_path = artifacts.source_key(session_state.session_id, source_path.suffix or ".csv")
        if context_path is not None:
            session_state.description_path = artifacts.context_key(session_state.session_id)
        if transformed_path is not None:
            session_state.transformed_dataset = artifacts.transformed_dataset_key(session_state.session_id)

    def _sync_session_artifacts(self, session_id: str, state: SessionState | None = None) -> None:
        if not self.remote_artifacts_enabled:
            return

        source_path = artifacts.discover_source_path(self.config, session_id)
        upload_candidates: list[tuple[Path, str, str | None]] = [
            (artifacts.log_path(self.config, session_id), artifacts.log_key(session_id), artifacts.ARTIFACT_CONTENT_TYPES["log"]),
            (artifacts.state_path(self.config, session_id), artifacts.state_key(session_id), artifacts.ARTIFACT_CONTENT_TYPES["state"]),
            (artifacts.trace_path(self.config, session_id), artifacts.trace_key(session_id), artifacts.ARTIFACT_CONTENT_TYPES["trace"]),
            (
                artifacts.dashboard_spec_path(self.config, session_id),
                artifacts.dashboard_spec_key(session_id),
                artifacts.ARTIFACT_CONTENT_TYPES["dashboard_spec"],
            ),
            (artifacts.figures_path(self.config, session_id), artifacts.figures_key(session_id), artifacts.ARTIFACT_CONTENT_TYPES["figures"]),
            (artifacts.context_path(self.config, session_id), artifacts.context_key(session_id), artifacts.ARTIFACT_CONTENT_TYPES["context"]),
            (
                artifacts.transformed_dataset_path(self.config, session_id),
                artifacts.transformed_dataset_key(session_id),
                artifacts.ARTIFACT_CONTENT_TYPES["transformed_dataset"],
            ),
        ]
        if source_path is not None:
            upload_candidates.append(
                (source_path, artifacts.source_key(session_id, source_path.suffix or ".csv"), artifacts.ARTIFACT_CONTENT_TYPES["source"])
            )

        for local_path, key, content_type in upload_candidates:
            if local_path.exists():
                self.artifact_store.upload_file(local_path, key, content_type=content_type)

    def _ensure_local_artifact(self, key: str, *, refresh: bool = False) -> Path:
        local_path = self._artifact_local_path_from_key(key)
        if local_path.exists() and not refresh:
            return local_path
        if not self.remote_artifacts_enabled:
            return local_path
        return self.artifact_store.materialize(key, destination=local_path)

    def _hydrate_remote_session(self, session_id: str) -> None:
        if not self.remote_artifacts_enabled:
            return
        keys_to_hydrate = [
            (artifacts.log_key(session_id), True),
            (artifacts.state_key(session_id), True),
            (artifacts.trace_key(session_id), True),
            (artifacts.dashboard_spec_key(session_id), True),
            (artifacts.figures_key(session_id), True),
            (artifacts.context_key(session_id), False),
        ]
        for key, refresh in keys_to_hydrate:
            if self.artifact_store.exists(key):
                self._ensure_local_artifact(key, refresh=refresh)
        source_matches = self.artifact_store.list_keys(f"outputs/source_{session_id}")
        for key in source_matches:
            self._ensure_local_artifact(key)

    def _materialize_stored_dataset(self, dataset_key: str, session_id: str, filename: str) -> Path:
        suffix = Path(filename).suffix or Path(dataset_key).suffix or ".csv"
        destination = artifacts.source_path(self.config, session_id, suffix)
        destination.parent.mkdir(parents=True, exist_ok=True)
        return self.artifact_store.materialize(dataset_key, destination=destination)

    def _session_ids_from_store(self) -> list[str]:
        session_ids: set[str] = set()
        for key in self.artifact_store.list_keys("logs/session_"):
            name = Path(key).name
            if name.endswith(".state.json"):
                session_ids.add(name.removesuffix(".state.json"))
            elif name.endswith(".log"):
                session_ids.add(Path(name).stem)
        return sorted(session_ids, reverse=True)

    def _summary_keys_from_store(self) -> dict[str, set[str]]:
        session_keys: dict[str, set[str]] = {}
        for key in self.artifact_store.list_keys("logs/session_"):
            name = Path(key).name
            if name.endswith(".state.json"):
                session_id = name.removesuffix(".state.json")
                session_keys.setdefault(session_id, set()).add("state")
            elif name.endswith(".log"):
                session_id = Path(name).stem
                session_keys.setdefault(session_id, set()).add("log")
        return session_keys

    def _hydrate_remote_session_summary(self, session_id: str, available_keys: set[str]) -> None:
        key = artifacts.state_key(session_id) if "state" in available_keys else artifacts.log_key(session_id)
        try:
            self._ensure_local_artifact(key, refresh=True)
        except FileNotFoundError:
            return

    def _is_local_path_reference(self, value: str) -> bool:
        return bool(value) and Path(value).is_absolute()

    def _artifact_key(
        self,
        session_id: str,
        artifact_type: artifacts.ArtifactType,
        state: SessionState | None = None,
    ) -> str | None:
        if artifact_type == "log":
            return artifacts.log_key(session_id)
        if artifact_type == "state":
            return artifacts.state_key(session_id)
        if artifact_type == "trace":
            return artifacts.trace_key(session_id)
        if artifact_type == "dashboard_spec":
            return artifacts.dashboard_spec_key(session_id)
        if artifact_type == "figures":
            return artifacts.figures_key(session_id)
        if artifact_type == "context":
            if state and state.description_path and not self._is_local_path_reference(state.description_path):
                return state.description_path
            return artifacts.context_key(session_id)
        if artifact_type == "transformed_dataset":
            if state and state.transformed_dataset and not self._is_local_path_reference(state.transformed_dataset):
                return state.transformed_dataset
            if state and state.transformed_dataset:
                return artifacts.transformed_dataset_key(session_id)
            return None
        if artifact_type == "source":
            if state and state.data_path and not self._is_local_path_reference(state.data_path):
                return state.data_path
            local_source = artifacts.discover_source_path(self.config, session_id, state=state)
            if local_source is not None:
                return artifacts.source_key(session_id, local_source.suffix or ".csv")
            if self.remote_artifacts_enabled:
                matches = self.artifact_store.list_keys(f"outputs/source_{session_id}")
                return matches[0] if matches else None
        return None

    def analyze_uploaded_dataset(
        self,
        *,
        filename: str,
        content: bytes,
        context_text: str | None = None,
    ) -> AnalyzeResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        source_path = self._write_source_artifact(session_id, filename, content)
        context_path = self._write_context_artifact(session_id, context_text)
        return self._analyze_local_source(
            session_id=session_id,
            session_logger=session_logger,
            source_path=source_path,
            context_path=context_path,
            api_mode="analyze",
        )

    def analyze_stored_dataset(
        self,
        *,
        dataset_key: str,
        filename: str,
        context_text: str | None = None,
    ) -> AnalyzeResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        source_path = self._materialize_stored_dataset(dataset_key, session_id, filename)
        context_path = self._write_context_artifact(session_id, context_text)
        return self._analyze_local_source(
            session_id=session_id,
            session_logger=session_logger,
            source_path=source_path,
            context_path=context_path,
            api_mode="analyze_stored",
        )

    def list_google_sheets_worksheets(
        self,
        *,
        spreadsheet_url: str | None = None,
        spreadsheet_id: str | None = None,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        workbook = GoogleSheetsClient().list_worksheets(
            spreadsheet_url or spreadsheet_id or "",
            access_token=access_token,
        )
        return {
            "spreadsheet_id": workbook.spreadsheet_id,
            "title": workbook.title,
            "worksheets": [
                {
                    "sheet_id": worksheet.sheet_id,
                    "title": worksheet.title,
                    "index": worksheet.index,
                    "row_count": worksheet.row_count,
                    "column_count": worksheet.column_count,
                }
                for worksheet in workbook.worksheets
            ],
        }

    def analyze_google_sheet(
        self,
        *,
        spreadsheet_url: str | None = None,
        spreadsheet_id: str | None = None,
        worksheet_id: int | None = None,
        worksheet_name: str | None = None,
        access_token: str | None = None,
        context_text: str | None = None,
    ) -> AnalyzeResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        source_path = self._materialize_google_sheet(
            session_id=session_id,
            spreadsheet_url=spreadsheet_url,
            spreadsheet_id=spreadsheet_id,
            worksheet_id=worksheet_id,
            worksheet_name=worksheet_name,
            access_token=access_token,
        )
        context_path = self._write_context_artifact(session_id, context_text)
        return self._analyze_local_source(
            session_id=session_id,
            session_logger=session_logger,
            source_path=source_path,
            context_path=context_path,
            api_mode="analyze_google_sheets",
        )

    def generate_uploaded_dataset(
        self,
        *,
        filename: str,
        content: bytes,
        context_text: str | None = None,
    ) -> GenerateResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        source_path = self._write_source_artifact(session_id, filename, content)
        context_path = self._write_context_artifact(session_id, context_text)
        return self._generate_local_source(
            session_id=session_id,
            session_logger=session_logger,
            source_path=source_path,
            context_path=context_path,
            api_mode="generate",
        )

    def generate_stored_dataset(
        self,
        *,
        dataset_key: str,
        filename: str,
        context_text: str | None = None,
    ) -> GenerateResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        source_path = self._materialize_stored_dataset(dataset_key, session_id, filename)
        context_path = self._write_context_artifact(session_id, context_text)
        return self._generate_local_source(
            session_id=session_id,
            session_logger=session_logger,
            source_path=source_path,
            context_path=context_path,
            api_mode="generate_stored",
        )

    def generate_google_sheet(
        self,
        *,
        spreadsheet_url: str | None = None,
        spreadsheet_id: str | None = None,
        worksheet_id: int | None = None,
        worksheet_name: str | None = None,
        access_token: str | None = None,
        context_text: str | None = None,
    ) -> GenerateResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        source_path = self._materialize_google_sheet(
            session_id=session_id,
            spreadsheet_url=spreadsheet_url,
            spreadsheet_id=spreadsheet_id,
            worksheet_id=worksheet_id,
            worksheet_name=worksheet_name,
            access_token=access_token,
        )
        context_path = self._write_context_artifact(session_id, context_text)
        return self._generate_local_source(
            session_id=session_id,
            session_logger=session_logger,
            source_path=source_path,
            context_path=context_path,
            api_mode="generate_google_sheets",
        )

    def _analyze_local_source(
        self,
        *,
        session_id: str,
        session_logger: SessionLogger,
        source_path: Path,
        context_path: Path | None,
        api_mode: str,
    ) -> AnalyzeResult:
        description_text = _read_description(context_path)

        session_logger.section("Input Configuration")
        session_logger.log_kv(
            {
                "data": str(source_path),
                "description": str(context_path) if context_path else "",
                "api_mode": api_mode,
            }
        )

        sample_df = _load_for_analysis(source_path, self.config.sample_rows)
        analyzer = Analyzer(self.config)
        session_logger.section("Phase 1: Analysis")
        analysis = analyzer.run_analysis(sample_df, description_text, session_logger)
        session_logger.log_json("Analysis Report", analysis.model_dump())

        session_state = SessionState(
            session_id=session_id,
            status="planned",
            data_path=str(source_path),
            description_path=str(context_path) if context_path else "",
            analysis=analysis,
            trace=ExecutionTrace(session_id=session_id, current_stage="approve_edit", status="planned"),
            active_spec=analysis.design.model_copy(deep=True),
            spec_versions=[analysis.design.model_copy(deep=True)],
            decisions=["Analysis-only API request generated a draft dashboard spec."],
        )
        self._normalize_session_locations(session_state, source_path=source_path, context_path=context_path)
        session_logger.log_dashboard_spec(analysis.design.model_dump())
        session_logger.log_session_state(session_state)
        session_logger.log_execution_trace(session_state.trace)
        self._write_json_artifact(artifacts.dashboard_spec_path(self.config, session_id), analysis.design.model_dump())
        self._sync_session_artifacts(session_id, session_state)

        return AnalyzeResult(
            session_id=session_id,
            analysis=analysis,
            dashboard_spec=analysis.design,
            artifacts=self.list_artifacts(session_id, state=session_state),
        )

    def _generate_local_source(
        self,
        *,
        session_id: str,
        session_logger: SessionLogger,
        source_path: Path,
        context_path: Path | None,
        api_mode: str,
    ) -> GenerateResult:
        description_text = _read_description(context_path)

        session_logger.section("Input Configuration")
        session_logger.log_kv(
            {
                "data": str(source_path),
                "description": str(context_path) if context_path else "",
                "api_mode": api_mode,
                "output_format": "json",
            }
        )

        sample_df = _load_for_analysis(source_path, self.config.sample_rows)
        analyzer = Analyzer(self.config)
        session_logger.section("Phase 1: Analysis")
        analysis = analyzer.run_analysis(sample_df, description_text, session_logger)
        session_logger.log_json("Analysis Report", analysis.model_dump())

        registry = build_registry()
        orchestrator = Orchestrator(self.config, registry)
        navigator = NavigatorAgent(orchestrator)
        proposal_result = navigator.propose(
            analysis=analysis,
            data_path=source_path,
            description_path=context_path,
            user_goal=source_path.name,
            session_id=session_id,
        )
        session_state = navigator.approve(proposal_result.session_state, reason="Auto-approved by API generation.")
        self._normalize_session_locations(session_state, source_path=source_path, context_path=context_path)
        api_plan = [call for call in proposal_result.plan if call.tool_name != "build_dashboard"]

        session_logger.section("Phase 2: Orchestration")
        execution_result = orchestrator.execute_plan(
            plan=api_plan,
            output_format="html",
            output_path=self.config.outputs_dir / f"dashboard_{session_id}.html",
            port=8050,
            logger_ctx=session_logger,
            trace=session_state.trace,
            defer_export=True,
        )
        session_state = navigator.review_execution(session_state, execution_result)

        review_dataframe = execution_result.baseline_dataframe if execution_result.baseline_dataframe is not None else execution_result.dataframe
        figures = self._render_figures(review_dataframe, session_state)

        if execution_result.dataframe is not None and execution_result.transformations_applied:
            transformed_path = artifacts.transformed_dataset_path(self.config, session_id)
            safe_dataframe = _prepare_dataframe_for_parquet(execution_result.dataframe)
            try:
                safe_dataframe.to_parquet(transformed_path, index=False)
            except Exception as exc:
                session_logger.log_kv({"transformed_dataset": f"skipped ({exc})"})
            else:
                session_state.transformed_dataset = str(transformed_path)
                self._normalize_session_locations(session_state, transformed_path=transformed_path)
                session_logger.log_kv({"transformed_dataset": str(transformed_path)})

        session_state.output_path = ""
        session_logger.section("Phase 3: Output Generation")
        session_logger.log_kv(
            {
                "output_path": "api-json",
                "transformations": ", ".join(execution_result.transformations_applied) or "none",
                "guardrail_warnings": ", ".join(execution_result.warnings) or "none",
                "status": session_state.status,
            }
        )
        self._persist_session_artifacts(session_logger, session_state, figures=figures)

        return GenerateResult(
            session_id=session_id,
            analysis=analysis,
            dashboard_spec=session_state.active_spec,
            figures=figures,
            session_status=session_state.status,
            artifacts=self.list_artifacts(session_id, state=session_state),
        )

    def generate_from_path(
        self,
        *,
        data_path: Path,
        description_path: Path | None = None,
        output_format: str = "json",
        port: int = 8050,
        review_only: bool = False,
    ) -> CliRunResult:
        session_logger = init_session_logger(self.config.logs_dir)
        session_id = session_logger.path.stem
        description_text = _read_description(description_path)

        session_logger.section("Input Configuration")
        session_logger.log_kv(
            {
                "data": str(data_path),
                "description": str(description_path) if description_path else "",
                "review_only": review_only,
                "output_format": output_format,
                "port": port,
            }
        )

        sample_df = _load_for_analysis(data_path, self.config.sample_rows)
        analyzer = Analyzer(self.config)
        session_logger.section("Phase 1: Analysis")
        analysis = analyzer.run_analysis(sample_df, description_text, session_logger)
        session_logger.log_json("Analysis Report", analysis.model_dump())

        registry = build_registry()
        orchestrator = Orchestrator(self.config, registry)
        navigator = NavigatorAgent(orchestrator)
        proposal_result = navigator.propose(
            analysis=analysis,
            data_path=data_path,
            description_path=description_path,
            user_goal=data_path.name,
            session_id=session_id,
        )
        session_logger.log_json("Plan Proposal", proposal_result.proposal.model_dump())
        session_state = proposal_result.session_state
        self._normalize_session_locations(session_state, source_path=data_path, context_path=description_path)

        if review_only:
            session_state.status = "planned"
            session_state.trace.current_stage = "approve_edit"
            session_logger.section("Plan Review")
            session_logger.log_kv({"status": "review_only", "next_step": "Run without --review-only to execute the approved plan."})
            self._persist_session_artifacts(session_logger, session_state)
            self._sync_session_artifacts(session_id, session_state)
            return CliRunResult(
                session_id=session_id,
                session_log=session_logger.path,
                session_state=session_state,
                analysis=analysis,
                figures=[],
                rendered_output=None,
            )

        session_state = navigator.approve(session_state)
        session_logger.section("Phase 2: Orchestration")
        execution_result = orchestrator.execute_plan(
            plan=proposal_result.plan,
            output_format="html",
            output_path=self.config.outputs_dir / f"dashboard_{session_id}.html",
            port=port,
            logger_ctx=session_logger,
            trace=session_state.trace,
            defer_export=True,
        )
        session_state = navigator.review_execution(session_state, execution_result)

        review_dataframe = execution_result.baseline_dataframe if execution_result.baseline_dataframe is not None else execution_result.dataframe
        figure_objects = self._build_figures(review_dataframe, session_state)
        figures = self._serialize_figures(figure_objects)

        if execution_result.dataframe is not None and execution_result.transformations_applied:
            transformed_path = artifacts.transformed_dataset_path(self.config, session_id)
            safe_dataframe = _prepare_dataframe_for_parquet(execution_result.dataframe)
            try:
                safe_dataframe.to_parquet(transformed_path, index=False)
            except Exception as exc:
                session_logger.log_kv({"transformed_dataset": f"skipped ({exc})"})
            else:
                session_state.transformed_dataset = str(transformed_path)
                self._normalize_session_locations(session_state, transformed_path=transformed_path)
                session_logger.log_kv({"transformed_dataset": str(transformed_path)})

        rendered_output = None
        if output_format in {"html", "server", "dash"} and review_dataframe is not None:
            rendered_output = self._render_dashboard_output(
                df=review_dataframe,
                session_state=session_state,
                figures=figure_objects,
                output_format=output_format,
                output_path=self.config.outputs_dir / f"dashboard_{session_id}.html",
                port=port,
            )

        session_state.output_path = "" if rendered_output is None else str(rendered_output)
        session_logger.section("Phase 3: Output Generation")
        session_logger.log_kv(
            {
                "output_path": str(rendered_output) if rendered_output else "server mode" if output_format in {"server", "dash"} else "api-json",
                "transformations": ", ".join(execution_result.transformations_applied) or "none",
                "guardrail_warnings": ", ".join(execution_result.warnings) or "none",
            }
        )
        self._persist_session_artifacts(session_logger, session_state, figures=figures)
        self._sync_session_artifacts(session_id, session_state)

        return CliRunResult(
            session_id=session_id,
            session_log=session_logger.path,
            session_state=session_state,
            analysis=analysis,
            figures=figures,
            rendered_output=rendered_output,
        )

    def update_session(self, *, session_id: str, prompt: str) -> UpdateResult:
        self._hydrate_remote_session(session_id)
        cli_result = self.update_from_log_path(
            session_log=artifacts.log_path(self.config, session_id),
            prompt=prompt,
            output_format="json",
        )

        return UpdateResult(
            session_id=session_id,
            dashboard_spec=cli_result.session_state.active_spec,
            figures=cli_result.figures,
            session_status=cli_result.session_state.status,
            revision_count=len(cli_result.session_state.spec_versions),
            artifacts=self.list_artifacts(session_id, state=cli_result.session_state),
        )

    def undo_session_update(self, *, session_id: str) -> UpdateResult:
        self._hydrate_remote_session(session_id)
        state = self._load_state(session_id)
        if state is None:
            raise FileNotFoundError(session_id)
        if len(state.spec_versions) < 2:
            raise ValueError("No previous dashboard revision is available.")

        state.spec_versions.pop()
        state.active_spec = state.spec_versions[-1].model_copy(deep=True)
        state.pending_patch = None
        if state.plan is not None:
            state.plan.design = state.active_spec.model_copy(deep=True)
        state.updated_at = _utc_now()
        state.decisions.append("Reverted the latest dashboard refinement from the review page.")

        df = self._load_dataframe_for_state(state)
        figures = self._render_figures(df, state)
        session_logger = SessionLogger(path=artifacts.log_path(self.config, session_id))
        session_logger.log_json(
            "Dashboard Revision Restored",
            {"revision_count": len(state.spec_versions)},
        )
        self._persist_session_artifacts(session_logger, state, figures=figures)

        return UpdateResult(
            session_id=session_id,
            dashboard_spec=state.active_spec,
            figures=figures,
            session_status=state.status,
            revision_count=len(state.spec_versions),
            artifacts=self.list_artifacts(session_id, state=state),
        )

    def patch_session(
        self,
        *,
        session_id: str,
        title: str | None = None,
        visual_order: list[str] | None = None,
    ) -> SessionDetail:
        self._hydrate_remote_session(session_id)
        state = self._load_state(session_id)
        if state is None:
            raise FileNotFoundError(session_id)

        current_visuals = list(state.active_spec.visuals)
        current_figures = self._load_figures_artifact(session_id)
        figure_by_visual_id = {
            visual.id: current_figures[index]
            for index, visual in enumerate(current_visuals)
            if index < len(current_figures)
        }

        spec = state.active_spec.model_copy(deep=True)
        if title is not None and title.strip():
            spec.title = title.strip()
            if state.plan is not None:
                state.plan.design.title = spec.title

        if visual_order:
            wanted = [visual_id for visual_id in visual_order if visual_id]
            visual_by_id = {visual.id: visual for visual in spec.visuals}
            reordered = [visual_by_id[visual_id] for visual_id in wanted if visual_id in visual_by_id]
            reordered.extend([visual for visual in spec.visuals if visual.id not in wanted])
            if len(reordered) == len(spec.visuals):
                spec.visuals = reordered
                current_figures = [
                    figure_by_visual_id[visual.id]
                    for visual in reordered
                    if visual.id in figure_by_visual_id
                ]

        state.active_spec = spec
        if state.plan is not None:
            state.plan.design = spec.model_copy(deep=True)
        if state.spec_versions:
            state.spec_versions[-1] = spec.model_copy(deep=True)
        else:
            state.spec_versions.append(spec.model_copy(deep=True))
        state.updated_at = _utc_now()
        state.decisions.append("Session metadata updated from dashboard UI.")

        session_logger = SessionLogger(path=artifacts.log_path(self.config, session_id))
        self._persist_session_artifacts(session_logger, state, figures=current_figures)
        return self.get_session_detail(session_id)

    def render_session_figures(self, *, session_id: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self._hydrate_remote_session(session_id)
        state = self._load_state(session_id)
        if state is None:
            raise FileNotFoundError(session_id)
        df = self._load_dataframe_for_state(state)
        filtered = self._apply_session_filters(df, filters or {})
        return self._render_figures(filtered, state)

    def finalize_session(self, *, session_id: str) -> GenerateResult:
        self._hydrate_remote_session(session_id)
        state = self._load_state(session_id)
        if state is None:
            raise FileNotFoundError(session_id)

        figures = self._load_figures_artifact(session_id)
        if not figures:
            df = self._load_dataframe_for_state(state)
            figures = self._render_figures(df, state)

        state.status = "reviewed"
        state.active_spec.approval_status = "reviewed"
        state.active_spec.visuals = [
            visual.model_copy(update={"status": "rendered"})
            for visual in state.active_spec.visuals
        ]
        if state.plan is not None:
            state.plan.approved = True
            state.plan.design = state.active_spec.model_copy(deep=True)
        if state.spec_versions:
            state.spec_versions[-1] = state.active_spec.model_copy(deep=True)
        else:
            state.spec_versions.append(state.active_spec.model_copy(deep=True))
        state.updated_at = _utc_now()
        state.decisions.append("Dashboard finalized from review page.")

        session_logger = SessionLogger(path=artifacts.log_path(self.config, session_id))
        self._persist_session_artifacts(session_logger, state, figures=figures)

        return GenerateResult(
            session_id=session_id,
            analysis=state.analysis,
            dashboard_spec=state.active_spec,
            figures=figures,
            session_status=state.status,
            artifacts=self.list_artifacts(session_id, state=state),
        )

    def update_from_log_path(
        self,
        *,
        session_log: Path,
        prompt: str,
        data_path: Path | None = None,
        output_format: str = "json",
        port: int = 8050,
    ) -> CliRunResult:
        if not session_log.exists():
            candidate_key = artifacts.log_key(session_log.stem)
            if self.remote_artifacts_enabled and self.artifact_store.exists(candidate_key):
                session_log = self._ensure_local_artifact(candidate_key)
            else:
                raise FileNotFoundError(session_log)
        self._hydrate_remote_session(session_log.stem)

        session_logger = SessionLogger(path=session_log)
        session_state = load_session_state(session_log)
        session_id = session_log.stem

        session_logger.section("Phase 3: Update Mode")
        current_spec = session_state.active_spec.model_copy(deep=True)
        if session_state.spec_versions:
            session_state.spec_versions[-1] = current_spec
        else:
            session_state.spec_versions.append(current_spec)
        patch = parse_update_prompt(prompt, session_state.active_spec.model_copy(deep=True))
        updated_spec = apply_dashboard_patch(session_state.active_spec.model_copy(deep=True), patch)
        session_state.active_spec = updated_spec
        session_state.spec_versions.append(updated_spec.model_copy(deep=True))
        session_state.pending_patch = patch
        session_state.decisions.append(f"Update prompt applied: {prompt}")

        resolved_data_path = data_path or self._resolve_update_data_path(session_state)
        df = _load_for_analysis(resolved_data_path, self.config.sample_rows)
        figure_objects = self._build_figures(df, session_state)
        figures = self._serialize_figures(figure_objects)

        rendered_output = None
        if output_format in {"html", "server", "dash"}:
            rendered_output = self._render_dashboard_output(
                df=df,
                session_state=session_state,
                figures=figure_objects,
                output_format=output_format,
                output_path=self.config.outputs_dir / f"dashboard_{session_id}.html",
                port=port,
            )
        session_state.output_path = "" if rendered_output is None else str(rendered_output)

        session_logger.log_json("Update Prompt", {"prompt": prompt})
        session_logger.log_json("Dashboard Patch", patch.model_dump())
        session_logger.log_json("Updated Dashboard Spec", updated_spec.model_dump())
        self._persist_session_artifacts(session_logger, session_state, figures=figures)
        self._sync_session_artifacts(session_id, session_state)

        return CliRunResult(
            session_id=session_id,
            session_log=session_log,
            session_state=session_state,
            analysis=session_state.analysis,
            figures=figures,
            rendered_output=rendered_output,
        )

    def list_sessions(self, *, limit: int = 25) -> list[SessionSummary]:
        if self.remote_artifacts_enabled:
            summary_keys = self._summary_keys_from_store()
            for session_id in sorted(summary_keys, reverse=True)[:limit]:
                self._hydrate_remote_session_summary(session_id, summary_keys[session_id])
        state_files = sorted(self.config.logs_dir.glob("session_*.state.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        seen: set[str] = set()
        summaries: list[SessionSummary] = []

        for state_file in state_files:
            session_id = state_file.name.removesuffix(".state.json")
            state = load_session_state(self.config.logs_dir / f"{session_id}.log")
            summaries.append(
                SessionSummary(
                    session_id=session_id,
                    status=state.status,
                    title=state.active_spec.title,
                    created_at=state.created_at,
                    updated_at=state.updated_at,
                )
            )
            seen.add(session_id)

        log_files = sorted(self.config.logs_dir.glob("session_*.log"), key=lambda item: item.stat().st_mtime, reverse=True)
        for log_file in log_files:
            session_id = log_file.stem
            if session_id in seen:
                continue
            if len(summaries) >= limit:
                break
            metadata = load_session_metadata(log_file)
            try:
                title = load_dashboard_spec(log_file).get("title", "Signal Dashboard")
            except Exception:
                title = "Signal Dashboard"
            summaries.append(
                SessionSummary(
                    session_id=session_id,
                    status=metadata.get("status", "unknown"),
                    title=title,
                    created_at=str(log_file.stat().st_ctime),
                    updated_at=str(log_file.stat().st_mtime),
                )
            )
        return sorted(summaries, key=lambda item: self._sort_timestamp(item.created_at), reverse=True)[:limit]

    def get_session_detail(self, session_id: str) -> SessionDetail:
        self._hydrate_remote_session(session_id)
        state = self._load_state(session_id)
        detail_spec = self._load_dashboard_spec_artifact(session_id)
        figures = self._load_figures_artifact(session_id)
        dataset_profile = self._dataset_profile(state)
        return SessionDetail(
            session_id=session_id,
            status=state.status if state else "unknown",
            revision_count=len(state.spec_versions) if state else 0,
            analysis=state.analysis.model_dump() if state and state.analysis else None,
            dashboard_spec=detail_spec,
            figures=figures,
            artifacts=self.list_artifacts(session_id, state=state),
            dataset_profile=dataset_profile,
        )

    def resolve_artifact(self, session_id: str, artifact_type: artifacts.ArtifactType) -> Path | None:
        self._hydrate_remote_session(session_id)
        state = self._load_state(session_id)
        path = artifacts.resolve_artifact_path(self.config, session_id, artifact_type, state=state)
        if path is not None and path.exists():
            return path
        artifact_key = self._artifact_key(session_id, artifact_type, state=state)
        if artifact_key and self.artifact_store.exists(artifact_key):
            return self._ensure_local_artifact(artifact_key)
        return None

    def list_artifacts(self, session_id: str, state: SessionState | None = None) -> list[dict[str, str]]:
        items: list[dict[str, str]] = []
        for artifact_type in artifacts.ARTIFACT_CONTENT_TYPES:
            path = artifacts.resolve_artifact_path(self.config, session_id, artifact_type, state=state)
            artifact_key = self._artifact_key(session_id, artifact_type, state=state)
            local_exists = path is not None and path.exists()
            remote_exists = artifact_key is not None and self.artifact_store.exists(artifact_key)
            if not local_exists and not remote_exists:
                continue
            location = (
                str(path)
                if local_exists
                else self.artifact_store.location(artifact_key) if artifact_key is not None else ""
            )
            items.append(
                {
                    "type": artifact_type,
                    "path": location,
                    "url": f"/artifacts/{session_id}/{artifact_type}",
                    "content_type": artifacts.ARTIFACT_CONTENT_TYPES[artifact_type],
                }
            )
        return items

    def _write_source_artifact(self, session_id: str, filename: str, content: bytes) -> Path:
        suffix = Path(filename).suffix or ".csv"
        path = artifacts.source_path(self.config, session_id, suffix)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def _materialize_google_sheet(
        self,
        *,
        session_id: str,
        spreadsheet_url: str | None,
        spreadsheet_id: str | None,
        worksheet_id: int | None,
        worksheet_name: str | None,
        access_token: str | None,
    ) -> Path:
        sheet_csv = GoogleSheetsClient().fetch_sheet_csv(
            spreadsheet_url or spreadsheet_id or "",
            worksheet_id=worksheet_id,
            worksheet_name=worksheet_name,
            access_token=access_token,
        )
        return self._write_source_artifact(session_id, sheet_csv.filename, sheet_csv.content)

    def _write_context_artifact(self, session_id: str, context_text: str | None) -> Path | None:
        if not context_text:
            return None
        path = artifacts.context_path(self.config, session_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(context_text, encoding="utf-8")
        return path

    def _write_json_artifact(self, path: Path, payload: Any) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return path

    def _persist_session_artifacts(
        self,
        session_logger: SessionLogger,
        session_state: SessionState,
        *,
        figures: list[dict[str, Any]] | None = None,
    ) -> None:
        session_logger.log_dashboard_spec(session_state.active_spec.model_dump())
        session_logger.log_session_state(session_state)
        session_logger.log_execution_trace(session_state.trace)
        self._write_json_artifact(
            artifacts.dashboard_spec_path(self.config, session_state.session_id),
            session_state.active_spec.model_dump(),
        )
        if figures is not None:
            self._write_json_artifact(artifacts.figures_path(self.config, session_state.session_id), figures)
        self._sync_session_artifacts(session_state.session_id, session_state)

    def _load_state(self, session_id: str) -> SessionState | None:
        self._hydrate_remote_session(session_id)
        log_path = artifacts.log_path(self.config, session_id)
        if not log_path.exists():
            return None
        try:
            return load_session_state(log_path)
        except FileNotFoundError:
            return None

    def _load_dashboard_spec_artifact(self, session_id: str) -> dict[str, Any]:
        self._hydrate_remote_session(session_id)
        artifact_path = artifacts.dashboard_spec_path(self.config, session_id)
        if artifact_path.exists():
            return json.loads(artifact_path.read_text(encoding="utf-8"))
        log_path = artifacts.log_path(self.config, session_id)
        if not log_path.exists():
            raise FileNotFoundError(session_id)
        return load_dashboard_spec(log_path)

    def _load_figures_artifact(self, session_id: str) -> list[dict[str, Any]]:
        self._hydrate_remote_session(session_id)
        artifact_path = artifacts.figures_path(self.config, session_id)
        if not artifact_path.exists():
            return []
        return json.loads(artifact_path.read_text(encoding="utf-8"))

    def _render_figures(self, df: pd.DataFrame | None, session_state: SessionState) -> list[dict[str, Any]]:
        return self._serialize_figures(self._build_figures(df, session_state))

    def _build_figures(self, df: pd.DataFrame | None, session_state: SessionState) -> list[Any]:
        if df is None:
            return []
        figures: list[Any] = []
        for spec in session_state.active_spec.visuals:
            try:
                figure = create_figure(df, spec, theme=session_state.active_spec.theme)
            except Exception as exc:
                figure = error_figure(spec.title, f"Unable to render chart: {exc}", theme=session_state.active_spec.theme)
            figures.append(figure)
        return figures

    def _serialize_figures(self, figures: list[Any]) -> list[dict[str, Any]]:
        return [serialize_figure(figure) for figure in figures]

    def _render_dashboard_output(
        self,
        *,
        df: pd.DataFrame,
        session_state: SessionState,
        figures: list[Any],
        output_format: str,
        output_path: Path,
        port: int,
    ) -> Path | None:
        from src.dashboard.builder import build_dashboard

        dashboard = build_dashboard(df, session_state.active_spec, session_state=session_state)
        return export_dashboard(
            output_format=output_format,
            output_path=output_path,
            title=session_state.active_spec.title,
            figures=figures,
            app=dashboard.app,
            port=port,
        )

    def _resolve_update_data_path(self, session_state: SessionState) -> Path:
        if session_state.data_path and Path(session_state.data_path).exists():
            return Path(session_state.data_path)
        if session_state.data_path and not self._is_local_path_reference(session_state.data_path):
            return self._ensure_local_artifact(session_state.data_path)
        if session_state.transformed_dataset and Path(session_state.transformed_dataset).exists():
            return Path(session_state.transformed_dataset)
        if session_state.transformed_dataset and not self._is_local_path_reference(session_state.transformed_dataset):
            return self._ensure_local_artifact(session_state.transformed_dataset)
        raise FileNotFoundError(f"No dataset artifact available for session '{session_state.session_id}'.")

    def _load_dataframe_for_state(self, session_state: SessionState) -> pd.DataFrame:
        return _load_for_analysis(self._resolve_update_data_path(session_state), sample_rows=None)  # type: ignore[arg-type]

    def _dataset_profile(self, session_state: SessionState | None) -> dict[str, Any]:
        if session_state is None:
            return {}
        try:
            df = self._load_dataframe_for_state(session_state)
        except Exception:
            return {}

        missing_cells = int(df.isna().sum().sum())
        duplicate_rows = int(df.duplicated().sum())
        numeric_columns = df.select_dtypes(include="number").columns.tolist()
        analysis = session_state.analysis
        dimensions = (
            list(analysis.metrics.dimensions)
            if analysis is not None
            else [column for column in df.columns if column not in numeric_columns]
        )
        filter_columns = list(dict.fromkeys(list(session_state.active_spec.filters) + dimensions))
        filter_options: dict[str, list[Any]] = {}
        for column in filter_columns:
            if column not in df.columns:
                continue
            values = df[column].dropna().unique().tolist()
            normalized = sorted(
                (self._json_scalar(value) for value in values[:200]),
                key=lambda item: str(item),
            )
            filter_options[column] = normalized

        return {
            "row_count": int(len(df)),
            "column_count": int(len(df.columns)),
            "missing_cells": missing_cells,
            "duplicate_rows": duplicate_rows,
            "numeric_column_count": int(len(numeric_columns)),
            "dimension_count": int(len(dimensions)),
            "dimensions": dimensions,
            "filter_options": filter_options,
            "quality_score": self._quality_score(session_state),
        }

    def _quality_score(self, session_state: SessionState) -> int:
        penalties = {"high": 24, "medium": 12, "low": 5}
        score = 100
        if session_state.analysis is not None:
            for issue in session_state.analysis.quality.issues:
                score -= penalties.get(issue.severity, 5)
        else:
            score -= 5 * len(session_state.active_spec.data_quality_summary)
        return max(0, min(100, score))

    def _json_scalar(self, value: Any) -> Any:
        if value is None:
            return None
        try:
            if pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass
        if isinstance(value, pd.Timestamp):
            return value.isoformat()
        if hasattr(value, "item"):
            try:
                return value.item()
            except Exception:
                pass
        if isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    def _apply_session_filters(self, df: pd.DataFrame, filters: dict[str, Any]) -> pd.DataFrame:
        result = df
        for column, raw_value in filters.items():
            if column not in result.columns:
                continue
            if raw_value is None or raw_value == "__all__":
                continue
            values = raw_value if isinstance(raw_value, list) else [raw_value]
            normalized_values = {str(value) for value in values if value not in {None, "__all__"}}
            if not normalized_values:
                continue
            result = result[result[column].astype(str).isin(normalized_values)]
        return result

    def _sort_timestamp(self, value: str) -> float:
        try:
            return datetime.fromisoformat(value).timestamp()
        except ValueError:
            try:
                return float(value)
            except ValueError:
                return 0.0


def serialize_figure(figure: Any) -> dict[str, Any]:
    return json.loads(pio.to_json(figure))
