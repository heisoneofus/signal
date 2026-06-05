from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from backend.errors import ApiError
from backend.schemas import (
    AnalyzeResponse,
    ErrorResponse,
    FigureFilterRequest,
    FiguresResponse,
    GenerateResponse,
    SessionDetailResponse,
    SessionPatchRequest,
    SessionsListResponse,
    StoredDatasetRequest,
    UpdateRequest,
    UpdateResponse,
)
import src.services.artifacts as artifact_service


class LazyApplicationService:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir
        self._instance = None

    def _get_instance(self):
        if self._instance is None:
            from src.services import ApplicationService

            self._instance = ApplicationService(root_dir=self.root_dir)
        return self._instance

    def __getattr__(self, name: str):
        return getattr(self._get_instance(), name)


def create_app(root_dir: Path | None = None) -> FastAPI:
    resolved_root = (root_dir or Path(__file__).resolve().parent.parent).resolve()
    service = LazyApplicationService(root_dir=resolved_root)

    app = FastAPI(title="Signal API", version="0.1.0")

    @app.middleware("http")
    async def normalize_vercel_api_prefix(request: Request, call_next):
        if request.scope["path"] == "/api":
            request.scope["path"] = "/"
        elif request.scope["path"].startswith("/api/"):
            request.scope["path"] = request.scope["path"][4:]
        return await call_next(request)
    app.state.service = service
    local_frontend_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=local_frontend_origins,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request, exc: ApiError) -> JSONResponse:
        payload = ErrorResponse(code=exc.code, message=exc.message, details=exc.details)
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump())

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/analyze", response_model=AnalyzeResponse)
    async def analyze(
        dataset: UploadFile = File(...),
        context_text: str | None = Form(default=None),
    ) -> AnalyzeResponse:
        content = await dataset.read()
        result = service.analyze_uploaded_dataset(
            filename=dataset.filename or "dataset.csv",
            content=content,
            context_text=context_text,
        )
        return AnalyzeResponse(
            session_id=result.session_id,
            analysis=result.analysis.model_dump(),
            dashboard_spec=result.dashboard_spec.model_dump(),
            artifacts=result.artifacts,
        )

    @app.post("/analyze/stored", response_model=AnalyzeResponse)
    async def analyze_stored(payload: StoredDatasetRequest) -> AnalyzeResponse:
        result = service.analyze_stored_dataset(
            dataset_key=payload.dataset_key,
            filename=payload.filename,
            context_text=payload.context_text,
        )
        return AnalyzeResponse(
            session_id=result.session_id,
            analysis=result.analysis.model_dump(),
            dashboard_spec=result.dashboard_spec.model_dump(),
            artifacts=result.artifacts,
        )

    @app.post("/generate", response_model=GenerateResponse)
    async def generate(
        dataset: UploadFile = File(...),
        context_text: str | None = Form(default=None),
    ) -> GenerateResponse:
        content = await dataset.read()
        result = service.generate_uploaded_dataset(
            filename=dataset.filename or "dataset.csv",
            content=content,
            context_text=context_text,
        )
        return GenerateResponse(
            session_id=result.session_id,
            analysis=result.analysis.model_dump(),
            dashboard_spec=result.dashboard_spec.model_dump(),
            figures=result.figures,
            session_status=result.session_status,
            artifacts=result.artifacts,
        )

    @app.post("/generate/stored", response_model=GenerateResponse)
    async def generate_stored(payload: StoredDatasetRequest) -> GenerateResponse:
        result = service.generate_stored_dataset(
            dataset_key=payload.dataset_key,
            filename=payload.filename,
            context_text=payload.context_text,
        )
        return GenerateResponse(
            session_id=result.session_id,
            analysis=result.analysis.model_dump(),
            dashboard_spec=result.dashboard_spec.model_dump(),
            figures=result.figures,
            session_status=result.session_status,
            artifacts=result.artifacts,
        )

    @app.post("/update", response_model=UpdateResponse)
    async def update(payload: UpdateRequest) -> UpdateResponse:
        try:
            result = service.update_session(session_id=payload.session_id, prompt=payload.prompt)
        except FileNotFoundError as exc:
            raise ApiError("session_not_found", f"Session '{payload.session_id}' was not found.", 404, str(exc)) from exc
        return UpdateResponse(
            session_id=result.session_id,
            dashboard_spec=result.dashboard_spec.model_dump(),
            figures=result.figures,
            session_status=result.session_status,
            artifacts=result.artifacts,
        )

    @app.patch("/sessions/{session_id}", response_model=SessionDetailResponse)
    async def patch_session(session_id: str, payload: SessionPatchRequest) -> SessionDetailResponse:
        try:
            detail = service.patch_session(
                session_id=session_id,
                title=payload.title,
                visual_order=payload.visual_order,
            )
        except FileNotFoundError as exc:
            raise ApiError("session_not_found", f"Session '{session_id}' was not found.", 404, str(exc)) from exc
        return SessionDetailResponse(**detail.__dict__)

    @app.post("/sessions/{session_id}/figures", response_model=FiguresResponse)
    async def render_session_figures(session_id: str, payload: FigureFilterRequest) -> FiguresResponse:
        try:
            figures = service.render_session_figures(session_id=session_id, filters=payload.filters)
        except FileNotFoundError as exc:
            raise ApiError("session_not_found", f"Session '{session_id}' was not found.", 404, str(exc)) from exc
        return FiguresResponse(session_id=session_id, figures=figures)

    @app.post("/sessions/{session_id}/generate", response_model=GenerateResponse)
    async def generate_session(session_id: str) -> GenerateResponse:
        try:
            result = service.finalize_session(session_id=session_id)
        except FileNotFoundError as exc:
            raise ApiError("session_not_found", f"Session '{session_id}' was not found.", 404, str(exc)) from exc
        return GenerateResponse(
            session_id=result.session_id,
            analysis=result.analysis.model_dump() if result.analysis else {},
            dashboard_spec=result.dashboard_spec.model_dump(),
            figures=result.figures,
            session_status=result.session_status,
            artifacts=result.artifacts,
        )

    @app.get("/sessions", response_model=SessionsListResponse)
    async def list_sessions() -> SessionsListResponse:
        return SessionsListResponse(items=[item.__dict__ for item in service.list_sessions()])

    @app.get("/sessions/{session_id}", response_model=SessionDetailResponse)
    async def get_session(session_id: str) -> SessionDetailResponse:
        try:
            detail = service.get_session_detail(session_id)
        except FileNotFoundError as exc:
            raise ApiError("session_not_found", f"Session '{session_id}' was not found.", 404, str(exc)) from exc
        return SessionDetailResponse(**detail.__dict__)

    @app.get(
        "/artifacts/{session_id}/{artifact_type}",
        responses={404: {"model": ErrorResponse}},
    )
    async def get_artifact(session_id: str, artifact_type: str):
        if artifact_type not in artifact_service.ARTIFACT_CONTENT_TYPES:
            raise ApiError("artifact_not_found", f"Artifact type '{artifact_type}' is not available.", 404)
        path = service.resolve_artifact(session_id, artifact_type)  # type: ignore[arg-type]
        if path is None or not path.exists():
            raise ApiError("artifact_not_found", f"Artifact '{artifact_type}' for session '{session_id}' was not found.", 404)
        return FileResponse(path=path, media_type=artifact_service.ARTIFACT_CONTENT_TYPES[artifact_type], filename=path.name)

    return app


app = create_app()
