from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import pytest

from src.services.google_sheets import GoogleSheetsClient, GoogleSheetsError, parse_spreadsheet_id


class _FakeHeaders:
    def get_content_charset(self) -> str:
        return "utf-8"


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.headers = _FakeHeaders()

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def test_parse_spreadsheet_id_accepts_urls_and_raw_ids() -> None:
    raw_id = "1abcDEF_ghi-JKLmnop12345"

    assert parse_spreadsheet_id(raw_id) == raw_id
    assert parse_spreadsheet_id(f"https://docs.google.com/spreadsheets/d/{raw_id}/edit#gid=42") == raw_id


def test_google_sheets_client_lists_worksheets_and_fetches_csv() -> None:
    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        if "/values/" in request.full_url:
            return _FakeResponse(
                {
                    "values": [
                        ["region", "sales", "sales", ""],
                        ["EU", 10, 11, "north"],
                        ["US", 20, 21, "west"],
                    ]
                }
            )
        return _FakeResponse(
            {
                "properties": {"title": "Revenue Ops"},
                "sheets": [
                    {"properties": {"sheetId": 202, "title": "Q2", "index": 1, "gridProperties": {"rowCount": 10, "columnCount": 4}}},
                    {"properties": {"sheetId": 101, "title": "Q1", "index": 0, "gridProperties": {"rowCount": 20, "columnCount": 5}}},
                ],
            }
        )

    client = GoogleSheetsClient(api_key="api-key", urlopen=fake_urlopen)

    workbook = client.list_worksheets("spreadsheet12345")

    assert workbook.title == "Revenue Ops"
    assert [worksheet.title for worksheet in workbook.worksheets] == ["Q1", "Q2"]
    query = parse_qs(urlparse(requests[0][0].full_url).query)
    assert query["key"] == ["api-key"]

    sheet_csv = client.fetch_sheet_csv("spreadsheet12345", worksheet_id=101)

    assert sheet_csv.filename == "Revenue-Ops-Q1.csv"
    assert sheet_csv.content.decode("utf-8").splitlines()[0] == "region,sales,sales_2,Column 4"
    assert "EU,10,11,north" in sheet_csv.content.decode("utf-8")


def test_google_sheets_client_requires_auth_or_api_key() -> None:
    client = GoogleSheetsClient(api_key="", urlopen=lambda *_args, **_kwargs: None)

    with pytest.raises(GoogleSheetsError) as exc_info:
        client.list_worksheets("spreadsheet12345")

    assert exc_info.value.code == "google_sheets_auth_required"
    assert exc_info.value.status_code == 401
