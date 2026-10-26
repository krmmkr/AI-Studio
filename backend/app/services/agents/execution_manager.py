import asyncio
import inspect
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Any

logger = logging.getLogger("agent_execution_manager")

DEFAULT_TIMEOUT_SECONDS = 300.0  # 5-minute auto-cancel threshold


@dataclass
class ExecutionContext:
    session_id: str
    started_at: float = field(default_factory=time.monotonic)
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_reason: str | None = None
    _callbacks: list[Callable[[], Any]] = field(default_factory=list)

    def add_cancel_callback(self, callback: Callable[[], Any]) -> None:
        """Registers a synchronous or asynchronous callback to abort the underlying SDK run."""
        self._callbacks.append(callback)

    @property
    def is_cancelled(self) -> bool:
        return self.cancel_event.is_set()

    @property
    def elapsed_seconds(self) -> float:
        return time.monotonic() - self.started_at

    @property
    def is_timed_out(self) -> bool:
        return self.elapsed_seconds >= self.timeout_seconds

    async def trigger_cancel(self, reason: str = "user_stopped") -> None:
        if self.cancel_event.is_set():
            return
        self.cancel_reason = reason
        self.cancel_event.set()
        for cb in list(self._callbacks):
            try:
                res = cb()
                if inspect.isawaitable(res):
                    await res
            except Exception as e:
                logger.debug(f"Cancel callback warning for session {self.session_id}: {e}")


class AgentExecutionManager:
    """
    Tracks active agent streams per chat session, supporting:
    1. Explicit user stop (`POST /api/chat/sessions/{session_id}/stop`)
    2. Automatic cancellation on client tab close / SSE disconnect
    3. Automatic 5-minute (300s) execution timeout
    """

    def __init__(self) -> None:
        self._active: dict[str, ExecutionContext] = {}

    async def start_execution(
        self,
        session_id: str,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    ) -> ExecutionContext:
        # Cancel any prior dangling run on the same session before starting a new one
        existing = self._active.get(session_id)
        if existing and not existing.is_cancelled:
            await existing.trigger_cancel(reason="superseded")

        ctx = ExecutionContext(session_id=session_id, timeout_seconds=timeout_seconds)
        self._active[session_id] = ctx
        return ctx

    def get_execution(self, session_id: str) -> ExecutionContext | None:
        return self._active.get(session_id)

    async def stop_execution(self, session_id: str, reason: str = "user_stopped") -> bool:
        ctx = self._active.get(session_id)
        if not ctx:
            return False
        await ctx.trigger_cancel(reason=reason)
        return True

    def finish_execution(self, session_id: str, ctx: ExecutionContext | None = None) -> None:
        current = self._active.get(session_id)
        if current is not None and (ctx is None or current is ctx):
            self._active.pop(session_id, None)

    def list_active_sessions(self) -> list[dict[str, Any]]:
        return [
            {
                "session_id": sid,
                "elapsed_seconds": round(ctx.elapsed_seconds, 2),
                "is_cancelled": ctx.is_cancelled,
                "cancel_reason": ctx.cancel_reason,
            }
            for sid, ctx in self._active.items()
        ]


execution_manager = AgentExecutionManager()
