import json
import logging
import re
from pathlib import Path
from typing import Any
from backend.app.config import LOCAL_DATA_DIR

logger = logging.getLogger("agent_session_store")

SESSIONS_ROOT_DIR = LOCAL_DATA_DIR / "agent_sessions"
ANTIGRAVITY_SESSIONS_DIR = SESSIONS_ROOT_DIR / "antigravity"
OPENCODE_SESSIONS_DIR = SESSIONS_ROOT_DIR / "opencode"
SESSION_MAP_FILE = SESSIONS_ROOT_DIR / "session_map.json"


def sanitize_secret_text(text: str) -> str:
    """Removes tokens, passwords, authorization headers, and credential patterns."""
    if not text:
        return ""
    text = re.sub(r"(?i)(bearer\s+)[a-zA-Z0-9_\-\.]{20,}", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)(ghp_[a-zA-Z0-9]{30,})", "[REDACTED_TOKEN]", text)
    text = re.sub(r"(?i)(password\s*[:=]\s*)['\"][^'\"]+['\"]", r"\1'[REDACTED]'", text)
    return text


def _ensure_dirs() -> None:
    ANTIGRAVITY_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    OPENCODE_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


class AgentSessionStore:
    """
    Persists and resolves SDK conversation/session IDs so users can pause,
    stop, or return later to continue the exact same conversation context.
    - Antigravity SDK: Uses `SessionContinuationMode.CREATE_OR_RESUME` with `save_dir`
      and deterministic sanitized `conversation_id`.
    - OpenCode SDK: Persists `chat_session_id -> opencode_session_id` in `session_map.json`
      and falls back to SQLite `ChatMessage` transcript hydration if the OpenCode daemon restarts.
    """

    def __init__(self) -> None:
        _ensure_dirs()

    @property
    def antigravity_save_dir(self) -> str:
        _ensure_dirs()
        return str(ANTIGRAVITY_SESSIONS_DIR)

    @property
    def antigravity_app_data_dir(self) -> str:
        d = LOCAL_DATA_DIR / "antigravity_app_data"
        d.mkdir(parents=True, exist_ok=True)
        return str(d)

    @property
    def opencode_save_dir(self) -> str:
        _ensure_dirs()
        return str(OPENCODE_SESSIONS_DIR)

    def get_antigravity_conversation_id(self, chat_session_id: str) -> str:
        import hashlib
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "-", chat_session_id or "default")
        if len(safe_id) < 32:
            digest = hashlib.sha256(safe_id.encode("utf-8")).hexdigest()
            safe_id = f"{safe_id}-{digest[:32]}"
        return safe_id[:64]

    def _read_map(self) -> dict[str, dict[str, Any]]:
        _ensure_dirs()
        if not SESSION_MAP_FILE.exists():
            return {}
        try:
            return json.loads(SESSION_MAP_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"Failed to read session map file: {e}")
            return {}

    def _write_map(self, data: dict[str, dict[str, Any]]) -> None:
        _ensure_dirs()
        try:
            SESSION_MAP_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to write session map file: {e}")

    def get_sdk_session_id(self, chat_session_id: str, provider: str) -> str | None:
        data = self._read_map()
        entry = data.get(chat_session_id, {})
        return entry.get(provider)

    def set_sdk_session_id(self, chat_session_id: str, provider: str, sdk_session_id: str) -> None:
        data = self._read_map()
        entry = data.get(chat_session_id, {})
        entry[provider] = sdk_session_id
        data[chat_session_id] = entry
        self._write_map(data)

    def format_sqlite_history(self, history: list[dict[str, str]] | None, max_turns: int = 16) -> str:
        """
        Formats prior SQLite ChatMessage rows using Agor's sliding-window compaction pattern.
        - For short histories (<= 4 turns): Preserves all turns verbatim.
        - For longer histories (> 4 turns): Compacts earlier turns into concise milestone
          summaries, preserving the most recent 4 dialogue turns verbatim.
        - Automatically strips oversized JSON blobs and redacts credential tokens.
        """
        if not history:
            return ""

        # Limit total considered window
        window = history[-max_turns:]
        if not window:
            return ""

        def _clean_turn_text(text: str) -> str:
            cleaned = re.sub(
                r"```json\s*\{.*?\}\s*```",
                "[Mounted ECharts Widget on Canvas]",
                text or "",
                flags=re.DOTALL
            )
            return sanitize_secret_text(cleaned).strip()

        # If 4 or fewer turns, retain all verbatim
        if len(window) <= 4:
            turns: list[str] = []
            for msg in window:
                role_label = "User" if msg.get("role") == "user" else "Assistant"
                text = _clean_turn_text(msg.get("content") or "")
                if text:
                    turns.append(f"{role_label}: {text[:1200]}")
            if not turns:
                return ""
            return "[CONVERSATION CONTEXT FROM PRIOR TURNS]:\n" + "\n".join(turns) + "\n\n"

        # Split into earlier milestone turns and recent verbatim turns
        earlier_turns = window[:-4]
        recent_turns = window[-4:]

        milestones: list[str] = []
        for msg in earlier_turns:
            role = msg.get("role")
            text = _clean_turn_text(msg.get("content") or "")
            if not text:
                continue
            # Extract first sentence or key clause
            first_line = text.split("\n")[0].strip()
            summary = first_line[:140] + ("…" if len(first_line) > 140 else "")
            if role == "user":
                milestones.append(f"- User inquired: {summary}")
            else:
                milestones.append(f"- Assistant established: {summary}")

        recent_formatted: list[str] = []
        for msg in recent_turns:
            role_label = "User" if msg.get("role") == "user" else "Assistant"
            text = _clean_turn_text(msg.get("content") or "")
            if text:
                recent_formatted.append(f"{role_label}: {text[:1200]}")

        parts = []
        if milestones:
            parts.append("[EARLIER MILESTONES & DECISION CONTEXT]:\n" + "\n".join(milestones))
        if recent_formatted:
            parts.append("[RECENT DIALOGUE TURNS]:\n" + "\n".join(recent_formatted))

        return "\n\n".join(parts) + "\n\n"


session_store = AgentSessionStore()
