from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ArtifactDescriptor(BaseModel):
    type: str
    path: str
    url: str
    content_type: str


class AnalyzeResponse(BaseModel):
    session_id: str
    analysis: dict[str, Any]
    dashboard_spec: dict[str, Any]
    artifacts: list[ArtifactDescriptor] = Field(default_factory=list)


class GenerateResponse(AnalyzeResponse):
    figures: list[dict[str, Any]] = Field(default_factory=list)
    session_status: str


class UpdateRequest(BaseModel):
    session_id: str
    prompt: str


class SessionPatchRequest(BaseModel):
    title: str | None = None
    visual_order: list[str] | None = None
    pinned: bool | None = None


class FigureFilterRequest(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict)


class StoredDatasetRequest(BaseModel):
    dataset_key: str
    filename: str
    context_text: str | None = None


class GoogleSheetsWorksheetsRequest(BaseModel):
    spreadsheet_url: str | None = None
    spreadsheet_id: str | None = None
    access_token: str | None = None


class GoogleSheetsDatasetRequest(GoogleSheetsWorksheetsRequest):
    worksheet_id: int | None = None
    worksheet_name: str | None = None
    context_text: str | None = None


class GoogleWorksheetResponse(BaseModel):
    sheet_id: int
    title: str
    index: int
    row_count: int | None = None
    column_count: int | None = None


class GoogleSheetsWorksheetsResponse(BaseModel):
    spreadsheet_id: str
    title: str
    worksheets: list[GoogleWorksheetResponse] = Field(default_factory=list)


class UpdateResponse(BaseModel):
    session_id: str
    dashboard_spec: dict[str, Any]
    figures: list[dict[str, Any]] = Field(default_factory=list)
    session_status: str
    revision_count: int = 1
    artifacts: list[ArtifactDescriptor] = Field(default_factory=list)
    changed: bool = True
    changes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class FiguresResponse(BaseModel):
    session_id: str
    figures: list[dict[str, Any]] = Field(default_factory=list)


class SessionSummaryResponse(BaseModel):
    session_id: str
    status: str
    title: str
    created_at: str
    updated_at: str
    pinned: bool = False


class SessionsListResponse(BaseModel):
    items: list[SessionSummaryResponse] = Field(default_factory=list)


class SessionDetailResponse(BaseModel):
    session_id: str
    status: str
    pinned: bool = False
    revision_count: int = 1
    analysis: dict[str, Any] | None = None
    dashboard_spec: dict[str, Any]
    figures: list[dict[str, Any]] = Field(default_factory=list)
    artifacts: list[ArtifactDescriptor] = Field(default_factory=list)
    dataset_profile: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: str | None = None
