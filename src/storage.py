from __future__ import annotations

import mimetypes
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

try:
    from vercel.blob import BlobClient
except ImportError:  # pragma: no cover - optional dependency
    BlobClient = None  # type: ignore[assignment]


def _normalize_key(key: str) -> str:
    return key.replace("\\", "/").lstrip("/")


def _guess_content_type(path: Path, explicit: str | None = None) -> str | None:
    if explicit:
        return explicit
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed


class ArtifactStore:
    is_remote = False

    def write_bytes(self, key: str, content: bytes, *, content_type: str | None = None) -> str:
        raise NotImplementedError

    def read_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def list_keys(self, prefix: str) -> list[str]:
        raise NotImplementedError

    def materialize(self, key: str, *, destination: Path | None = None) -> Path:
        raise NotImplementedError

    def upload_file(self, local_path: Path, key: str, *, content_type: str | None = None) -> str:
        raise NotImplementedError

    def location(self, key: str) -> str:
        raise NotImplementedError


@dataclass
class LocalArtifactStore(ArtifactStore):
    root_dir: Path

    def _path(self, key: str) -> Path:
        return (self.root_dir / Path(_normalize_key(key))).resolve()

    def write_bytes(self, key: str, content: bytes, *, content_type: str | None = None) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return _normalize_key(key)

    def read_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def list_keys(self, prefix: str) -> list[str]:
        normalized_prefix = _normalize_key(prefix)
        keys: list[str] = []
        if not self.root_dir.exists():
            return keys
        for candidate in self.root_dir.rglob("*"):
            if not candidate.is_file():
                continue
            relative_key = candidate.relative_to(self.root_dir).as_posix()
            if relative_key.startswith(normalized_prefix):
                keys.append(relative_key)
        return sorted(keys)

    def materialize(self, key: str, *, destination: Path | None = None) -> Path:
        source_path = self._path(key)
        if destination is None:
            return source_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source_path.resolve() != destination.resolve():
            shutil.copy2(source_path, destination)
        return destination

    def upload_file(self, local_path: Path, key: str, *, content_type: str | None = None) -> str:
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if local_path.resolve() != destination.resolve():
            shutil.copy2(local_path, destination)
        return _normalize_key(key)

    def location(self, key: str) -> str:
        return str(self._path(key))


@dataclass
class BlobArtifactStore(ArtifactStore):
    prefix: str = ""
    token: str | None = None
    is_remote: bool = True
    _client: BlobClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if BlobClient is None:  # pragma: no cover - optional dependency
            raise RuntimeError("The `vercel` package is required for Vercel Blob storage.")
        self._client = BlobClient(token=self.token)
        self.prefix = _normalize_key(self.prefix)

    def _remote_key(self, key: str) -> str:
        normalized = _normalize_key(key)
        return f"{self.prefix}/{normalized}" if self.prefix else normalized

    def _strip_prefix(self, key: str) -> str:
        normalized = _normalize_key(key)
        if self.prefix and normalized.startswith(f"{self.prefix}/"):
            return normalized[len(self.prefix) + 1 :]
        return normalized

    def write_bytes(self, key: str, content: bytes, *, content_type: str | None = None) -> str:
        self._client.put(
            self._remote_key(key),
            content,
            access="private",
            overwrite=True,
            add_random_suffix=False,
            content_type=content_type,
        )
        return _normalize_key(key)

    def read_bytes(self, key: str) -> bytes:
        result = self._client.get(self._remote_key(key), access="private")
        if result is None or result.status_code >= 400:
            raise FileNotFoundError(key)
        return result.content

    def exists(self, key: str) -> bool:
        try:
            self._client.head(self._remote_key(key))
        except Exception:
            return False
        return True

    def list_keys(self, prefix: str) -> list[str]:
        remote_prefix = self._remote_key(prefix)
        return sorted(self._strip_prefix(item.pathname) for item in self._client.iter_objects(prefix=remote_prefix))

    def materialize(self, key: str, *, destination: Path | None = None) -> Path:
        if destination is None:
            temp_dir = Path(tempfile.gettempdir()) / "signal-store"
            temp_dir.mkdir(parents=True, exist_ok=True)
            destination = temp_dir / Path(_normalize_key(key)).name
        destination.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(
            self._remote_key(key),
            destination,
            access="private",
            overwrite=True,
            create_parents=True,
        )
        return destination

    def upload_file(self, local_path: Path, key: str, *, content_type: str | None = None) -> str:
        self._client.upload_file(
            local_path,
            self._remote_key(key),
            access="private",
            overwrite=True,
            add_random_suffix=False,
            content_type=_guess_content_type(local_path, explicit=content_type),
        )
        return _normalize_key(key)

    def location(self, key: str) -> str:
        return self._remote_key(key)


def create_artifact_store(work_dir: Path) -> ArtifactStore:
    configured_backend = os.getenv("SIGNAL_STORAGE_BACKEND", "").strip().lower()
    token = os.getenv("BLOB_READ_WRITE_TOKEN") or os.getenv("VERCEL_BLOB_READ_WRITE_TOKEN")

    if configured_backend == "local":
        return LocalArtifactStore(root_dir=work_dir)
    if configured_backend == "blob" or token:
        return BlobArtifactStore(prefix=os.getenv("SIGNAL_BLOB_PREFIX", ""), token=token)
    return LocalArtifactStore(root_dir=work_dir)
