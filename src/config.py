from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LLMConfig:
    model: str = "gpt-5.2"
    analysis_temperature: float = 0.3
    tool_temperature: float = 0.1
    api_key: str | None = None


@dataclass(frozen=True)
class AppConfig:
    root_dir: Path
    work_dir: Path
    logs_dir: Path
    outputs_dir: Path
    llm: LLMConfig = LLMConfig()
    sample_rows: int = 5000

    @staticmethod
    def default(root_dir: Path) -> "AppConfig":
        configured_work_dir = os.getenv("SIGNAL_WORK_DIR", "").strip()
        llm_api_key = os.getenv("SIGNAL_OPENAI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip() or None
        llm_model = os.getenv("SIGNAL_OPENAI_MODEL", "").strip() or LLMConfig.model
        if configured_work_dir:
            work_dir = Path(configured_work_dir).expanduser().resolve()
        elif os.getenv("VERCEL"):
            work_dir = (Path(tempfile.gettempdir()) / "signal").resolve()
        else:
            work_dir = root_dir.resolve()
        return AppConfig(
            root_dir=root_dir.resolve(),
            work_dir=work_dir,
            logs_dir=work_dir / "logs",
            outputs_dir=work_dir / "outputs",
            llm=LLMConfig(model=llm_model, api_key=llm_api_key),
        )
