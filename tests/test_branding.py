from __future__ import annotations

from pathlib import Path

from backend.main import create_app
from src.config import AppConfig
from src.dashboard.templates import default_dashboard
from src.models import DashboardSpec


def test_backend_and_default_dashboard_use_signal_brand() -> None:
    assert create_app(Path.cwd()).title == "Signal API"
    assert DashboardSpec().title == "Signal Dashboard"
    assert default_dashboard().title == "Signal Dashboard"


def test_signal_work_dir_env_var_is_used(monkeypatch, tmp_path: Path) -> None:
    signal_dir = tmp_path / "signal-work"
    monkeypatch.setenv("SIGNAL_WORK_DIR", str(signal_dir))

    config = AppConfig.default(tmp_path)

    assert config.work_dir == signal_dir.resolve()
