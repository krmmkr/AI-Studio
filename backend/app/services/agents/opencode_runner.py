import asyncio
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import AsyncGenerator, Any
import httpx

from backend.app.config import OPENCODE_MODEL, REPOS_DIR, find_opencode_binary
from backend.app.services.agents.execution_manager import ExecutionContext
from backend.app.services.agents.session_store import session_store, sanitize_secret_text
from backend.app.services.agents.tools import (
    load_agent_context,
    get_catalog_context_summary,
    get_dashboard_context,
    build_agent_tools,
    extract_and_persist_canvas_actions,
    build_layered_system_prompt,
)

logger = logging.getLogger("opencode_runner")


class OpenCodeV2Server:
    """
    Manages a persistent OpenCode v2 server daemon (`opencode serve`) and authenticated
    HTTP client using HTTP Basic Auth ('opencode', server_password).
    """

    def __init__(self) -> None:
        self.process: subprocess.Popen[str] | None = None
        self.url: str | None = None
        self.password: str | None = None
        self.client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()

    async def get_client(self) -> httpx.AsyncClient:
        async with self._lock:
            if self.client and not self.client.is_closed and self.process and self.process.poll() is None:
                return self.client

            await self.close()

            bin_path = find_opencode_binary()
            if not bin_path:
                raise FileNotFoundError(
                    "OpenCode executable was not found on this system. "
                    "Please install OpenCode or use Antigravity SDK (`LLM_PROVIDER=antigravity`)."
                )

            home_dir = os.environ.get("HOME", "/tmp")
            if not os.path.isdir(home_dir) or not os.access(home_dir, os.W_OK):
                home_dir = "/tmp"
            env = {**os.environ, "HOME": home_dir, "TMPDIR": "/tmp"}
            proc = subprocess.Popen(
                [bin_path, "serve", "--hostname=127.0.0.1", "--port=0"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                cwd=str(REPOS_DIR),
            )
            self.process = proc

            url = None
            password = None
            for _ in range(30):
                line = await asyncio.to_thread(proc.stdout.readline)
                if not line:
                    break
                m_url = re.search(r"listening on (http://[^\s]+)", line)
                if m_url:
                    url = m_url.group(1).rstrip("/")
                m_pw = re.search(r"server password\s+([^\s]+)", line)
                if m_pw:
                    password = m_pw.group(1).strip()
                if url and password:
                    break

            if not url or not password:
                if proc.poll() is not None:
                    err_out = proc.stdout.read() if proc.stdout else ""
                    raise RuntimeError(f"OpenCode server process exited prematurely: {err_out}")
                raise RuntimeError(f"Failed to discover OpenCode v2 URL/password: url={url}")

            self.url = url
            self.password = password
            self.client = httpx.AsyncClient(
                base_url=url,
                auth=httpx.BasicAuth("opencode", password),
                timeout=httpx.Timeout(120.0, connect=10.0),
            )
            logger.info(f"OpenCode v2 server active at {url}")
            return self.client

    async def create_session(self) -> str:
        cli = await self.get_client()
        res = await cli.post("/api/session", json={})
        res.raise_for_status()
        data = res.json().get("data", {})
        return data.get("id")

    async def interrupt(self, session_id: str) -> bool:
        try:
            cli = await self.get_client()
            res = await cli.post(f"/api/session/{session_id}/interrupt", json={})
            return res.status_code == 200
        except Exception as e:
            logger.debug(f"Interrupt for OpenCode session {session_id} caught: {e}")
            return False

    async def close(self) -> None:
        if self.client:
            try:
                await self.client.aclose()
            except Exception:
                pass
            self.client = None

        if self.process:
            try:
                self.process.terminate()
                await asyncio.to_thread(self.process.wait, timeout=3.0)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None
            self.url = None
            self.password = None


_OPENCODE_SERVER = OpenCodeV2Server()


def _parse_studio_tool_calls(text: str) -> list[dict[str, Any]]:
    """Extracts any ```studio_tool { ... } ``` JSON invocations emitted by the model."""
    calls: list[dict[str, Any]] = []
    for match in re.finditer(r"```studio_tool\s*(\{.*?\})\s*```", text, flags=re.DOTALL):
        try:
            obj = json.loads(match.group(1))
            if isinstance(obj, dict) and obj.get("name"):
                calls.append({
                    "name": str(obj["name"]),
                    "args": obj.get("args") if isinstance(obj.get("args"), dict) else {},
                })
        except Exception as e:
            logger.debug(f"Could not parse studio_tool block: {e}")
    return calls


async def stream_with_opencode_sdk(
    user_message: str,
    session_id: str = "default",
    current_dashboard_id: str | None = None,
    agent_id: str | None = "general",
    history: list[dict[str, str]] | None = None,
    scope: str | None = None,
    pin_id: int | None = None,
    widget_id: str | None = None,
    execution_ctx: ExecutionContext | None = None,
    parent_context: str = "",
    parent_session_id: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Streams responses using native OpenCode v2 protocol with:
    - Persistent session continuation mapped per `session_id`
    - Immediate cancellation via `/api/session/{id}/interrupt` on user Stop / disconnect / 2-min timeout
    - Full access to Studio GitHub & DuckDB tools (`analyze_git_repository`, `query_duckdb`,
      `materialize_duckdb_dataset`, `upsert_chart_widget`, `create_markdown_report_widget`)
    """
    model_str = OPENCODE_MODEL or "opencode/big-pickle"
    provider = "opencode"
    if "/" in model_str:
        provider, _ = model_str.split("/", 1)

    key_env_vars = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "google": "GEMINI_API_KEY",
        "groq": "GROQ_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "mistral": "MISTRAL_API_KEY",
    }
    req_key = key_env_vars.get(provider.lower())
    api_key_val = os.environ.get(req_key, "").strip() if req_key else None

    if req_key and not api_key_val:
        yield {
            "type": "token",
            "content": (
                f"### Missing API Key `{req_key}`\n\n"
                f"`LLM_PROVIDER=opencode` with `OPENCODE_MODEL={model_str}` requires `{req_key}` in `.env`, "
                f"or switch to `LLM_PROVIDER=antigravity`."
            ),
        }
        yield {"type": "done"}
        return

    dash_context, active_widgets, active_comments, _ = get_dashboard_context(current_dashboard_id)
    history_context = session_store.format_sqlite_history(history)

    emitted_canvas_actions: list[dict[str, Any]] = []
    emitted_proposals: list[dict[str, Any]] = []
    emitted_widget_ids: set[str] = set()
    tool_funcs = build_agent_tools(current_dashboard_id, emitted_canvas_actions, emitted_proposals)
    tool_map = {fn.__name__: fn for fn in tool_funcs}

    sample_repo = "agor"
    try:
        if REPOS_DIR.exists():
            for p in sorted(REPOS_DIR.iterdir()):
                if p.is_dir():
                    sample_repo = p.name.removesuffix(".git")
                    break
    except Exception:
        pass

    tool_instructions = (
        "[STUDIO PIPELINE TOOLS]:\n"
        "You can invoke Studio tools by emitting one or more ```studio_tool ... ``` JSON blocks:\n"
        f"- `{{\"name\": \"extract_repository_dataset_records\", \"args\": {{\"repo\": \"{sample_repo}\", \"extraction_mode\": \"features_and_modules\", \"path_filter\": \"\", \"search_pattern\": \"\", \"limit\": 150, \"propose_table_name\": \"{sample_repo}_features_by_author\", \"description\": \"Features, routes, and components with primary authors\"}}}}` (modes: `features_and_modules`, `issues_todos_and_fixes`, `file_ownership_and_churn`, `git_search`)\n"
        f"- `{{\"name\": \"analyze_git_repository\", \"args\": {{\"repo\": \"{sample_repo}\", \"branch\": \"\", \"limit\": 500}}}}`\n"
        f"- `{{\"name\": \"list_repository_files\", \"args\": {{\"repo\": \"{sample_repo}\", \"directory\": \"\", \"extension\": \"\"}}}}`\n"
        f"- `{{\"name\": \"read_repository_file\", \"args\": {{\"repo\": \"{sample_repo}\", \"file_path\": \"README.md\", \"start_line\": 1, \"end_line\": 150}}}}`\n"
        f"- `{{\"name\": \"search_repository_code\", \"args\": {{\"repo\": \"{sample_repo}\", \"query\": \"function\"}}}}`\n"
        f"- `{{\"name\": \"analyze_code_complexity\", \"args\": {{\"repo\": \"{sample_repo}\", \"file_path\": \"\"}}}}`\n"
        f"- `{{\"name\": \"propose_duckdb_dataset\", \"args\": {{\"table_name\": \"{sample_repo}_custom_dataset\", \"description\": \"...\", \"records\": [{{\"feature\": \"...\", \"author\": \"...\"}}], \"rationale\": \"...\"}}}}` (accepts dynamic `records` list OR `sql_query`)\n"
        f"- `{{\"name\": \"query_duckdb\", \"args\": {{\"query\": \"SELECT * FROM {sample_repo}_features_by_author LIMIT 20\"}}}}`\n"
        f"- `{{\"name\": \"upsert_chart_widget\", \"args\": {{\"title\": \"Features by Author\", \"archetype\": \"bar\", \"sql_query\": \"SELECT primary_author, COUNT(*) AS features FROM {sample_repo}_features_by_author GROUP BY 1 ORDER BY 2 DESC LIMIT 10\", \"x_field\": \"primary_author\", \"y_fields\": [\"features\"]}}}}` (also accepts `data_records` directly!)\n"
        f"- `{{\"name\": \"create_markdown_report_widget\", \"args\": {{\"title\": \"{sample_repo.title()} Engineering Report\", \"markdown_content\": \"### Executive Summary\\n...\"}}}}`\n"
        "- `{\"name\": \"ask_user_confirmation\", \"args\": {\"question\": \"Which aspect should we analyze next?\", \"options\": [\"Feature Authorship\", \"Codebase Issues & TODOs\", \"Module Complexity Hotspots\"]}}`\n"
        f"- `{{\"name\": \"propose_repository_command\", \"args\": {{\"repo\": \"{sample_repo}\", \"command\": \"npm test\", \"rationale\": \"Run test suite\"}}}}`\n"
        f"- `{{\"name\": \"propose_file_edit\", \"args\": {{\"repo\": \"{sample_repo}\", \"file_path\": \"src/index.ts\", \"proposed_content\": \"...\", \"rationale\": \"...\"}}}}`\n"
        "IMPORTANT RULES:\n"
        "1. Do NOT assume fixed `github_commits` or `github_contributors` tables exist. Create dynamic tables tailored to the user's request (e.g. features + authors, issues/TODOs + authors, module ownership) using `extract_repository_dataset_records` or `propose_duckdb_dataset`.\n"
        "2. Always propose datasets via `propose_duckdb_dataset` (or `propose_table_name` in `extract_repository_dataset_records`) so the user can review and approve.\n"
        "3. Keep your prose concise, non-repetitive, and grounded in the real repository data.\n"
    )

    try:
        http_client = await _OPENCODE_SERVER.get_client()
        saved_sid = session_store.get_sdk_session_id(session_id, "opencode")
        is_resumed_session = False
        opencode_sid: str

        if saved_sid:
            opencode_sid = saved_sid
            is_resumed_session = True
        else:
            opencode_sid = await _OPENCODE_SERVER.create_session()
            session_store.set_sdk_session_id(session_id, "opencode", opencode_sid)

        if execution_ctx is not None:
            execution_ctx.add_cancel_callback(
                lambda: asyncio.create_task(_OPENCODE_SERVER.interrupt(opencode_sid))
            )

        layered_instructions = build_layered_system_prompt(
            agent_id=agent_id,
            dashboard_id=current_dashboard_id,
            scope=scope,
            pin_id=pin_id,
            widget_id=widget_id,
            history_context=history_context if not is_resumed_session else "",
            parent_context=parent_context,
            parent_session_id=parent_session_id,
        )

        current_prompt = (
            f"{layered_instructions}\n\n"
            f"{tool_instructions}\n\n"
            f"User Request: {user_message}"
        )

        collected_all_text: list[str] = []

        for round_idx in range(3):
            if execution_ctx is not None and execution_ctx.is_cancelled:
                break

            yield {
                "type": "thought",
                "content": (
                    f"Running OpenCode ({model_str}) on session {opencode_sid[:8]}..."
                    if round_idx == 0
                    else f"Synthesizing tool results (round {round_idx + 1})..."
                ),
            }

            round_chunks: list[str] = []
            prompt_payload: dict[str, Any] = {"text": current_prompt}
            if model_str and model_str != "opencode/big-pickle":
                prompt_payload["model"] = model_str

            event_queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
            stop_sse = asyncio.Event()
            emitted_text_by_part: dict[str, int] = {}
            emitted_tool_states: dict[str, str] = {}

            async def _listen_sse_events() -> None:
                try:
                    async with http_client.stream("GET", "/api/event") as event_stream:
                        if execution_ctx is not None:
                            execution_ctx.add_cancel_callback(event_stream.aclose)

                        async for line in event_stream.aiter_lines():
                            if stop_sse.is_set():
                                break
                            if execution_ctx is not None and execution_ctx.is_cancelled:
                                break
                            if not line.startswith("data: "):
                                continue

                            try:
                                ev = json.loads(line[6:])
                            except Exception:
                                continue

                            ev_type = ev.get("type", "")
                            ev_data = ev.get("data") or ev.get("properties") or {}

                            ev_sid = ev_data.get("sessionID")
                            if ev_sid and ev_sid != opencode_sid:
                                continue

                            # 1. Delta tokens / reasoning
                            if ev_type == "message.part.delta":
                                field = ev_data.get("field", "text")
                                delta = ev_data.get("delta", "")
                                part_id = str(ev_data.get("partID") or "default")
                                if delta:
                                    if field in ("reasoning", "thought"):
                                        await event_queue.put({"type": "thought", "content": delta})
                                    else:
                                        emitted_text_by_part[part_id] = emitted_text_by_part.get(part_id, 0) + len(delta)
                                        round_chunks.append(delta)
                                        await event_queue.put({"type": "token", "content": delta})

                            # 2. Part updated
                            elif ev_type == "message.part.updated":
                                part = ev_data.get("part", {})
                                ptype = part.get("type", "")
                                part_id = str(part.get("id") or part.get("callID") or "default")
                                if ptype == "reasoning":
                                    r_text = part.get("text", "")
                                    if r_text:
                                        await event_queue.put({"type": "thought", "content": str(r_text)})
                                elif ptype == "text":
                                    t_text = str(part.get("text", ""))
                                    already_len = emitted_text_by_part.get(part_id, 0)
                                    if len(t_text) > already_len:
                                        new_suffix = t_text[already_len:]
                                        emitted_text_by_part[part_id] = len(t_text)
                                        round_chunks.append(new_suffix)
                                        await event_queue.put({"type": "token", "content": new_suffix})
                                elif ptype == "tool":
                                    tool_name = str(part.get("tool", "tool"))
                                    tool_state = part.get("state", {})
                                    if isinstance(tool_state, dict):
                                        st = str(tool_state.get("status", ""))
                                        prev_st = emitted_tool_states.get(part_id)
                                        if st == "running" and prev_st != "running":
                                            emitted_tool_states[part_id] = "running"
                                            await event_queue.put({
                                                "type": "tool_call",
                                                "name": tool_name,
                                                "args": tool_state.get("input", {}),
                                            })
                                        elif st in ("completed", "error") and prev_st != st:
                                            emitted_tool_states[part_id] = st
                                            await event_queue.put({
                                                "type": "tool_result",
                                                "name": tool_name,
                                                "result": {
                                                    "status": st,
                                                    "output": str(tool_state.get("output") or tool_state.get("error") or "")[:400],
                                                },
                                            })

                            # 3. Step started / status
                            elif ev_type in ("session.step.started", "session.execution.started"):
                                agent_label = ev_data.get("agent") or "analyst"
                                await event_queue.put({
                                    "type": "thought",
                                    "content": f"OpenCode step running ({agent_label})...",
                                })

                            # 4. Detect provider connection / retry failures early
                            elif ev_type == "session.retry.scheduled":
                                err_obj = ev_data.get("error", {})
                                err_msg = err_obj.get("message", "")
                                if (
                                    "ETIMEOUT" in err_msg
                                    or "ENOTFOUND" in err_msg
                                    or "provider.transport" in err_obj.get("type", "")
                                ):
                                    logger.warning(f"OpenCode provider transport error detected: {err_msg}")
                                    await _OPENCODE_SERVER.interrupt(opencode_sid)
                                    await event_queue.put({
                                        "type": "token",
                                        "content": (
                                            f"### OpenCode Provider Connection Notice\n\n"
                                            f"The OpenCode inference service is unreachable (`{err_msg}`).\n\n"
                                            f"**Recommended action**:\n"
                                            f"- Set `LLM_PROVIDER=antigravity` in `.env` for native Antigravity SDK execution.\n"
                                            f"- Or configure your external provider credentials (`OPENAI_API_KEY`, `GEMINI_API_KEY`) in `.env`."
                                        ),
                                    })
                                    stop_sse.set()
                                    break

                            # 5. Session idle / completion
                            elif ev_type in ("session.idle", "session.status"):
                                st = ev_data.get("status")
                                if ev_type == "session.idle" or (isinstance(st, dict) and st.get("type") == "idle"):
                                    stop_sse.set()
                                    break

                except asyncio.CancelledError:
                    pass
                except Exception as sse_err:
                    logger.debug(f"OpenCode SSE stream notice: {sse_err}")
                finally:
                    await event_queue.put(None)

            # Start SSE background listener
            sse_task = asyncio.create_task(_listen_sse_events())
            await asyncio.sleep(0.05)

            # Dispatch prompt
            try:
                prompt_res = await http_client.post(
                    f"/api/session/{opencode_sid}/prompt",
                    json=prompt_payload,
                )
            except Exception as pe:
                logger.error(f"Prompt task exception: {pe}")
                stop_sse.set()
                if not sse_task.done():
                    sse_task.cancel()
                yield {"type": "token", "content": f"\n\n**OpenCode Error**: `{pe}`"}
                break

            # Handle stale / invalid session ID (e.g. from previous server restart)
            if (
                (prompt_res.status_code in (400, 404) and ("session id" in prompt_res.text.lower() or "not found" in prompt_res.text.lower()))
                and is_resumed_session
                and round_idx == 0
            ):
                logger.info(f"Stale OpenCode session {opencode_sid} detected; creating fresh session...")
                stop_sse.set()
                if not sse_task.done():
                    sse_task.cancel()
                while not event_queue.empty():
                    try:
                        event_queue.get_nowait()
                    except Exception:
                        break
                opencode_sid = await _OPENCODE_SERVER.create_session()
                session_store.set_sdk_session_id(session_id, "opencode", opencode_sid)
                is_resumed_session = False
                current_prompt = f"{history_context}\n{current_prompt}"
                continue

            if prompt_res.status_code not in (200, 201):
                stop_sse.set()
                if not sse_task.done():
                    sse_task.cancel()
                err_text = prompt_res.text
                yield {
                    "type": "token",
                    "content": f"\n\n**OpenCode Prompt Error** (HTTP {prompt_res.status_code}): `{err_text}`",
                }
                break

            # Drain events from queue until done or stopped
            while True:
                queued_ev = await event_queue.get()
                if queued_ev is None:
                    break
                yield queued_ev

            if not sse_task.done():
                sse_task.cancel()

            round_text = "".join(round_chunks)
            collected_all_text.append(round_text)

            # Check if the model emitted any ```studio_tool ... ``` blocks
            studio_calls = _parse_studio_tool_calls(round_text)
            if not studio_calls:
                break

            tool_feedback_lines = ["[STUDIO TOOL EXECUTION RESULTS]:"]
            needs_followup = False
            for tc in studio_calls:
                if execution_ctx is not None and execution_ctx.is_cancelled:
                    break
                t_name = tc["name"]
                t_args = tc["args"]
                fn = tool_map.get(t_name)
                if not fn:
                    continue
                yield {"type": "tool_call", "name": t_name, "args": t_args}
                try:
                    res = await asyncio.to_thread(fn, **t_args)
                except Exception as te:
                    res = {"error": str(te)}
                yield {"type": "tool_result", "name": t_name, "result": res}

                while emitted_canvas_actions:
                    action_ev = emitted_canvas_actions.pop(0)
                    w_id = action_ev.get("widget", {}).get("id")
                    if w_id:
                        emitted_widget_ids.add(w_id)
                    yield action_ev

                while emitted_proposals:
                    yield emitted_proposals.pop(0)

                res_dict = res if isinstance(res, dict) else {}
                res_status = str(res_dict.get("status", "")).lower()
                if res_status in ("approval_requested", "proposal_created", "question_asked", "awaiting_user_approval"):
                    needs_followup = False
                    break

                if t_name in (
                    "list_repositories_and_datasets",
                    "list_git_branches",
                    "analyze_git_repository",
                    "query_duckdb",
                    "materialize_duckdb_dataset",
                    "list_repository_files",
                    "read_repository_file",
                    "search_repository_code",
                    "analyze_code_complexity",
                    "execute_approved_repository_command",
                    "apply_approved_file_edit",
                ):
                    needs_followup = True
                    res_json = sanitize_secret_text(json.dumps(res, default=str))[:4000]
                    tool_feedback_lines.append(f"Tool `{t_name}` returned:\n{res_json}")

            if not needs_followup:
                break

            current_prompt = (
                "\n".join(tool_feedback_lines)
                + "\n\nNow summarize the findings concisely and, if appropriate, mount visual charts or reports using `upsert_chart_widget` / `create_markdown_report_widget`."
            )

        full_text = "\n".join(collected_all_text)
        for extra_action in extract_and_persist_canvas_actions(
            full_text=full_text,
            current_dashboard_id=current_dashboard_id,
            active_widgets=active_widgets,
            active_comments=active_comments,
            provider_label=f"OpenCode ({model_str})",
            already_emitted_ids=emitted_widget_ids,
        ):
            yield extra_action

        # Also check if OpenCode wrote a markdown report file in the workspace
        file_match = re.search(r"Created\s+`?([^`\n\r]+\.md)`?", full_text)
        if file_match and current_dashboard_id:
            raw_file_str = file_match.group(1).strip()
            report_path = (REPOS_DIR / Path(raw_file_str).name).resolve()
            if report_path.exists() and report_path.is_file():
                try:
                    content = report_path.read_text(encoding="utf-8")
                    create_report_fn = tool_map.get("create_markdown_report_widget")
                    if create_report_fn:
                        create_report_fn(
                            title=f"Report: {report_path.stem.replace('_', ' ').title()}",
                            markdown_content=content,
                        )
                        while emitted_canvas_actions:
                            yield emitted_canvas_actions.pop(0)
                except Exception as e:
                    logger.warning(f"Failed to mount markdown file report: {e}")

    except asyncio.CancelledError:
        logger.info(f"OpenCode stream cancelled for session {session_id}")
    except Exception as e:
        logger.error(f"OpenCode streaming error: {e}")
        yield {
            "type": "token",
            "content": f"\n\n**OpenCode Execution Error**: `{e}`",
        }

    yield {"type": "done"}
