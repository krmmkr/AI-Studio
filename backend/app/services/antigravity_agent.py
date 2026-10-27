import logging
import os
from typing import AsyncGenerator, Any
from backend.app.config import GEMINI_API_KEY, LLM_PROVIDER, ANTIGRAVITY_API_KEY, ANTIGRAVITY_BASE_URL, OPENAI_API_KEY, find_opencode_binary
from backend.app.models import MCPConfig
from backend.app.services.agents.execution_manager import ExecutionContext
from backend.app.services.agents.antigravity_runner import stream_with_antigravity_sdk
from backend.app.services.agents.opencode_runner import stream_with_opencode_sdk
from backend.app.services.agents.tools import (
    load_agent_context,
    safe_extract_title,
    get_dashboard_context,
)

logger = logging.getLogger("antigravity_agent")

__all__ = [
    "AntigravityAgentService",
    "antigravity_agent",
    "load_agent_context",
    "safe_extract_title",
    "get_dashboard_context",
]


class AntigravityAgentService:
    """
    Modular agent orchestrator for Antigravity Studio.
    Routes execution strictly to the configured SDK provider (`LLM_PROVIDER=opencode` or `antigravity` in `.env`)
    with persistent session continuation, real-time cancellation, and zero regex/canned fallback responses.
    """

    def _resolve_api_key(self) -> str:
        api_key = (
            os.environ.get("ANTIGRAVITY_API_KEY")
            or ANTIGRAVITY_API_KEY
            or os.environ.get("GEMINI_API_KEY")
            or GEMINI_API_KEY
            or os.environ.get("OPENAI_API_KEY")
            or OPENAI_API_KEY
            or ""
        )
        return (api_key or "").strip()

    async def stream_chat(
        self,
        user_message: str,
        history: list[dict[str, str]],
        mcp_configs: list[MCPConfig],
        session_id: str = "default",
        current_dashboard_id: str | None = None,
        agent_id: str | None = "general",
        scope: str | None = None,
        pin_id: int | None = None,
        widget_id: str | None = None,
        execution_ctx: ExecutionContext | None = None,
        provider_override: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        parent_context: str = "",
        parent_session_id: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        active_provider = (
            provider_override or os.environ.get("LLM_PROVIDER") or LLM_PROVIDER or "antigravity"
        ).strip().lower()

        if active_provider == "opencode":
            has_opencode = bool(find_opencode_binary())
            if not has_opencode:
                logger.info("OpenCode requested but binary not found on system; seamlessly defaulting to Antigravity SDK.")
                active_provider = "antigravity"
            else:
                async for event in stream_with_opencode_sdk(
                    user_message=user_message,
                    session_id=session_id,
                    current_dashboard_id=current_dashboard_id,
                    agent_id=agent_id,
                    history=history,
                    scope=scope,
                    pin_id=pin_id,
                    widget_id=widget_id,
                    execution_ctx=execution_ctx,
                    parent_context=parent_context,
                    parent_session_id=parent_session_id,
                ):
                    yield event
                return

        api_key = self._resolve_api_key()
        try:
            async for event in stream_with_antigravity_sdk(
                user_message=user_message,
                mcp_configs=mcp_configs,
                session_id=session_id,
                current_dashboard_id=current_dashboard_id,
                agent_id=agent_id,
                api_key=api_key,
                history=history,
                scope=scope,
                pin_id=pin_id,
                widget_id=widget_id,
                execution_ctx=execution_ctx,
                base_url=base_url,
                model_override=model,
                parent_context=parent_context,
                parent_session_id=parent_session_id,
            ):
                yield event
        except Exception as err:
            logger.error(f"Antigravity SDK execution error: {err}")
            yield {
                "type": "token",
                "content": (
                    f"**Antigravity SDK Error**: `{err}`\n\n"
                    "Verify your LLM configuration in `.env` or runtime endpoint/model parameters "
                    "(e.g., `GEMINI_API_KEY`, `ANTIGRAVITY_BASE_URL`, `ANTIGRAVITY_MODEL`)."
                ),
            }
            yield {"type": "done"}


antigravity_agent = AntigravityAgentService()
