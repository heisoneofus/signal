from __future__ import annotations

import csv
import io
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Callable
from urllib import error, parse, request


SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
SPREADSHEET_ID_PATTERN = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")
RAW_SPREADSHEET_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{12,}$")


@dataclass
class GoogleWorksheet:
    sheet_id: int
    title: str
    index: int
    row_count: int | None = None
    column_count: int | None = None


@dataclass
class GoogleWorksheetsResult:
    spreadsheet_id: str
    title: str
    worksheets: list[GoogleWorksheet]


@dataclass
class GoogleSheetCsv:
    spreadsheet_id: str
    spreadsheet_title: str
    worksheet_id: int
    worksheet_title: str
    filename: str
    content: bytes


class GoogleSheetsError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, details: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


def parse_spreadsheet_id(value: str | None) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise GoogleSheetsError("google_sheets_missing_id", "Enter a Google Sheets URL or spreadsheet ID.")

    match = SPREADSHEET_ID_PATTERN.search(normalized)
    if match:
        return match.group(1)
    if RAW_SPREADSHEET_ID_PATTERN.match(normalized):
        return normalized
    raise GoogleSheetsError(
        "google_sheets_invalid_id",
        "Enter a valid Google Sheets URL or spreadsheet ID.",
    )


def _safe_filename_part(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned[:80] or "google-sheet"


def _dedupe_headers(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    result: list[str] = []
    for index, raw_header in enumerate(headers, start=1):
        header = raw_header.strip() or f"Column {index}"
        count = seen.get(header, 0) + 1
        seen[header] = count
        result.append(header if count == 1 else f"{header}_{count}")
    return result


def _rows_to_csv_bytes(rows: list[list[Any]]) -> bytes:
    if not rows:
        raise GoogleSheetsError("google_sheets_empty_sheet", "The selected sheet has no tabular data.")

    max_columns = max((len(row) for row in rows), default=0)
    if max_columns == 0:
        raise GoogleSheetsError("google_sheets_empty_sheet", "The selected sheet has no tabular data.")

    normalized_rows = [[("" if value is None else str(value)) for value in row] for row in rows]
    padded_rows = [row + [""] * (max_columns - len(row)) for row in normalized_rows]
    headers = _dedupe_headers(padded_rows[0])
    body_rows = [row for row in padded_rows[1:] if any(cell.strip() for cell in row)]

    if not any(header.strip() for header in headers) or not body_rows:
        raise GoogleSheetsError(
            "google_sheets_empty_sheet",
            "The selected sheet needs a header row and at least one data row.",
        )

    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(body_rows)
    return buffer.getvalue().encode("utf-8")


class GoogleSheetsClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        urlopen: Callable[..., Any] | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("GOOGLE_SHEETS_API_KEY", "")).strip()
        self.urlopen = urlopen or request.urlopen

    def list_worksheets(
        self,
        spreadsheet_url_or_id: str,
        *,
        access_token: str | None = None,
    ) -> GoogleWorksheetsResult:
        spreadsheet_id = parse_spreadsheet_id(spreadsheet_url_or_id)
        params = {
            "fields": "properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))",
        }
        payload = self._request_json(f"{SHEETS_API_BASE}/{spreadsheet_id}", params=params, access_token=access_token)
        worksheets = []
        for sheet in payload.get("sheets", []):
            properties = sheet.get("properties", {})
            grid = properties.get("gridProperties", {})
            worksheets.append(
                GoogleWorksheet(
                    sheet_id=int(properties["sheetId"]),
                    title=str(properties.get("title") or "Sheet"),
                    index=int(properties.get("index") or 0),
                    row_count=grid.get("rowCount"),
                    column_count=grid.get("columnCount"),
                )
            )

        if not worksheets:
            raise GoogleSheetsError(
                "google_sheets_no_worksheets",
                "No worksheets were found in that Google spreadsheet.",
            )

        worksheets.sort(key=lambda worksheet: worksheet.index)
        return GoogleWorksheetsResult(
            spreadsheet_id=spreadsheet_id,
            title=str(payload.get("properties", {}).get("title") or "Google Sheet"),
            worksheets=worksheets,
        )

    def fetch_sheet_csv(
        self,
        spreadsheet_url_or_id: str,
        *,
        worksheet_id: int | None = None,
        worksheet_name: str | None = None,
        access_token: str | None = None,
    ) -> GoogleSheetCsv:
        workbook = self.list_worksheets(spreadsheet_url_or_id, access_token=access_token)
        worksheet = self._select_worksheet(workbook.worksheets, worksheet_id=worksheet_id, worksheet_name=worksheet_name)
        escaped_title = worksheet.title.replace("'", "''")
        range_name = f"'{escaped_title}'"
        encoded_range = parse.quote(range_name, safe="")
        payload = self._request_json(
            f"{SHEETS_API_BASE}/{workbook.spreadsheet_id}/values/{encoded_range}",
            params={"majorDimension": "ROWS", "valueRenderOption": "FORMATTED_VALUE"},
            access_token=access_token,
        )
        content = _rows_to_csv_bytes(payload.get("values", []))
        filename = f"{_safe_filename_part(workbook.title)}-{_safe_filename_part(worksheet.title)}.csv"
        return GoogleSheetCsv(
            spreadsheet_id=workbook.spreadsheet_id,
            spreadsheet_title=workbook.title,
            worksheet_id=worksheet.sheet_id,
            worksheet_title=worksheet.title,
            filename=filename,
            content=content,
        )

    def _select_worksheet(
        self,
        worksheets: list[GoogleWorksheet],
        *,
        worksheet_id: int | None,
        worksheet_name: str | None,
    ) -> GoogleWorksheet:
        if worksheet_id is not None:
            for worksheet in worksheets:
                if worksheet.sheet_id == worksheet_id:
                    return worksheet
        if worksheet_name:
            normalized_name = worksheet_name.strip().casefold()
            for worksheet in worksheets:
                if worksheet.title.casefold() == normalized_name:
                    return worksheet
        raise GoogleSheetsError(
            "google_sheets_unknown_worksheet",
            "Choose one of the available worksheets before generating a dashboard.",
        )

    def _request_json(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        token = (access_token or "").strip()
        query = dict(params or {})
        if not token:
            if not self.api_key:
                raise GoogleSheetsError(
                    "google_sheets_auth_required",
                    "Connect Google Sheets or configure GOOGLE_SHEETS_API_KEY for shared spreadsheets.",
                    status_code=401,
                )
            query["key"] = self.api_key

        full_url = url
        if query:
            full_url = f"{url}?{parse.urlencode(query)}"

        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        try:
            with self.urlopen(request.Request(full_url, headers=headers), timeout=20) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                return json.loads(response.read().decode(charset))
        except error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            message = self._error_message(details) or "Google Sheets rejected the request."
            status_code = exc.code if exc.code in {400, 401, 403, 404} else 502
            code = "google_sheets_access_denied" if exc.code in {401, 403, 404} else "google_sheets_request_failed"
            raise GoogleSheetsError(code, message, status_code=status_code, details=details) from exc
        except error.URLError as exc:
            raise GoogleSheetsError(
                "google_sheets_unreachable",
                "Unable to reach Google Sheets right now.",
                status_code=502,
                details=str(exc.reason),
            ) from exc
        except json.JSONDecodeError as exc:
            raise GoogleSheetsError(
                "google_sheets_invalid_response",
                "Google Sheets returned an unreadable response.",
                status_code=502,
                details=str(exc),
            ) from exc

    def _error_message(self, details: str) -> str | None:
        try:
            payload = json.loads(details)
        except json.JSONDecodeError:
            return None
        error_payload = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error_payload, dict):
            message = error_payload.get("message")
            if isinstance(message, str):
                return message
        return None
