from typing import Any

__all__ = ["ApplicationService"]


def __getattr__(name: str) -> Any:
    if name == "ApplicationService":
        from src.services.application import ApplicationService

        return ApplicationService
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
