import os
import re
import uuid
from pathlib import Path
from backend.app.config import STORAGE_DIR

def sanitize_filename(filename: str) -> str:
    """Strip path traversal elements and keep only safe alphanumerics and basic punctuation."""
    clean_name = os.path.basename(filename)
    clean_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', clean_name)
    if not clean_name:
        clean_name = f"dataset_{uuid.uuid4().hex[:8]}.dat"
    return clean_name

def get_user_storage_dir(user_id: int) -> Path:
    """Return user-scoped directory within safe root and ensure it exists."""
    user_dir = STORAGE_DIR / f"user_{user_id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir

def safe_resolve_path(user_id: int, relative_path: str) -> Path:
    """
    Safely resolves a relative path within the user's storage sandbox.
    Guarantees against path traversal vulnerabilities.
    """
    user_dir = get_user_storage_dir(user_id).resolve()
    target_path = (user_dir / relative_path).resolve()

    # Enforce directory boundary with trailing separator
    safe_root = str(user_dir)
    if not safe_root.endswith(os.sep):
        safe_root += os.sep

    if not str(target_path).startswith(safe_root):
        raise PermissionError("Access denied: Path traversal outside user sandbox.")

    return target_path

def save_user_file(user_id: int, original_filename: str, content: bytes | str) -> tuple[str, str, int]:
    """
    Saves a dataset or export file to user's storage directory.
    Returns: (file_id, relative_path, file_size_in_bytes)
    """
    safe_name = sanitize_filename(original_filename)
    file_id = str(uuid.uuid4())
    relative_filename = f"{file_id}_{safe_name}"
    target_path = safe_resolve_path(user_id, relative_filename)

    if isinstance(content, str):
        content_bytes = content.encode("utf-8")
    else:
        content_bytes = content

    with open(target_path, "wb") as f:
        f.write(content_bytes)

    return file_id, relative_filename, len(content_bytes)

def read_user_file(user_id: int, relative_path: str) -> bytes:
    """Reads user file securely."""
    target_path = safe_resolve_path(user_id, relative_path)
    if not target_path.exists() or not target_path.is_file():
        raise FileNotFoundError("Requested file does not exist.")
    with open(target_path, "rb") as f:
        return f.read()

from typing import Protocol

class StorageProvider(Protocol):
    """Abstract interface for bulk dataset, report, and artifact storage backends."""
    def save(self, user_id: int, original_filename: str, content: bytes | str) -> tuple[str, str, int]: ...
    def read(self, user_id: int, relative_path: str) -> bytes: ...
    def delete(self, user_id: int, relative_path: str) -> bool: ...

class LocalStorageProvider:
    """POSIX filesystem storage implementation with path traversal isolation."""
    def save(self, user_id: int, original_filename: str, content: bytes | str) -> tuple[str, str, int]:
        return save_user_file(user_id, original_filename, content)

    def read(self, user_id: int, relative_path: str) -> bytes:
        return read_user_file(user_id, relative_path)

    def delete(self, user_id: int, relative_path: str) -> bool:
        try:
            target = safe_resolve_path(user_id, relative_path)
            if target.exists() and target.is_file():
                target.unlink()
                return True
            return False
        except Exception:
            return False

_current_storage_provider: StorageProvider = LocalStorageProvider()

def get_storage_provider() -> StorageProvider:
    """Returns the configured bulk storage provider (LocalStorageProvider or S3/Blob in cloud)."""
    return _current_storage_provider
