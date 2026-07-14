from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent


def test_vercel_python_function_excludes_generated_dependency_caches() -> None:
    config = json.loads((REPO_ROOT / "vercel.json").read_text(encoding="utf-8"))

    exclude_files = config["functions"]["api/**/*.py"]["excludeFiles"]

    assert ".vercel_python_packages/**" in exclude_files
    assert "node_modules/**" in exclude_files
    assert "frontend/dist/**" in exclude_files


def test_vercel_requirements_omit_cli_only_runtime_packages() -> None:
    requirements = (REPO_ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
    package_names = {line.split(">", maxsplit=1)[0].split("=", maxsplit=1)[0].strip() for line in requirements}

    assert "click" not in package_names
    assert "uvicorn" not in package_names


def test_vercel_exposes_nested_session_actions() -> None:
    session_actions = REPO_ROOT / "api" / "sessions" / "[session_id]"

    assert (session_actions / "figures.py").is_file()
    assert (session_actions / "generate.py").is_file()
    assert (session_actions / "undo.py").is_file()
