from __future__ import annotations

from pathlib import Path

from src.config import AppConfig


def test_default_config_reads_openai_key_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("SIGNAL_OPENAI_API_KEY", raising=False)

    config = AppConfig.default(Path.cwd())

    assert config.llm.api_key == "sk-test"


def test_signal_openai_key_takes_precedence(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("SIGNAL_OPENAI_API_KEY", "sk-signal")

    config = AppConfig.default(Path.cwd())

    assert config.llm.api_key == "sk-signal"
