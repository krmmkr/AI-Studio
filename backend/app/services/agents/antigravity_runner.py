import asyncio
import json
import logging
import re
import urllib.parse
from typing import AsyncGenerator, Any
from backend.app.config import REPOS_DIR, ANTIGRAVITY_MODEL, ANTIGRAVITY_BASE_URL, ANTIGRAVITY_API_KEY, OPENAI_API_KEY
from backend.app.models import MCPConfig
from backend.app.services.agents.execution_manager import ExecutionContext
from backend.app.services.agents.session_store import session_store
from backend.app.services.agents.tools import (
    load_agent_context,
    get_catalog_context_summary,
    get_dashboard_context,
    build_agent_tools,
    extract_and_persist_canvas_actions,
    build_layered_system_prompt,
)

logger = logging.getLogger("antigravity_runner")


async def check_mcp_streamable_valid(
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 0.8,
) -> bool:
    """
    Validates whether an MCP endpoint responds to Streamable HTTP initialize.
    If the server is offline or returns 404/500, it is skipped so the agent
    can execute safely without the Antigravity SDK aborting initialization.
    """
    import httpx

    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname
        if not host:
            return False
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        # Fast TCP pre-check
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=0.4
            )
            writer.close()
            await writer.wait_closed()
        except Exception as conn_err:
            logger.info(f"MCP server at {url} not reachable ({conn_err}), skipping")
            return False

        # Fast HTTP initialize probe
        req_headers = {"Content-Type": "application/json"}
        if headers:
            req_headers.update(headers)
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                url.strip(),
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "AI Studio", "version": "1.0"},
                    },
                },
                headers=req_headers,
            )
            is_valid = res.status_code in (200, 201)
            if not is_valid:
                logger.info(f"MCP server at {url} returned HTTP {res.status_code} on initialize, skipping")
            return is_valid
    except Exception as e:
        logger.info(f"MCP server at {url} probe failed ({e}), skipping")
        return False


async def start_auth_proxy(target_base_url: str, api_key: str):
    """
    Spins up a lightweight localhost reverse proxy on an ephemeral port.
    Injects `Authorization: Bearer <api_key>` into outgoing requests for OpenAI-compatible
    cloud APIs (DeepSeek, OpenRouter, Groq, Together, etc.) because the localharness binary's
    GemmaEndpoint client is unauthenticated by default.
    """
    import httpx
    import uvicorn
    from starlette.applications import Starlette
    from starlette.requests import Request
    from starlette.responses import StreamingResponse
    from starlette.routing import Route

    async def proxy_handler(request: Request):
        subpath = request.path_params.get("path", "").lstrip("/")
        target_clean = target_base_url.rstrip("/")
        if target_clean.endswith("/v1") and subpath.startswith("v1/"):
            subpath = subpath[3:].lstrip("/")
        target_url = f"{target_clean}/{subpath}"
        body = await request.body()
        req_headers = dict(request.headers)
        if api_key:
            req_headers["authorization"] = f"Bearer {api_key}"

        parsed_target = httpx.URL(target_base_url)
        req_headers["host"] = str(
            parsed_target.netloc.decode() if hasattr(parsed_target.netloc, "decode") else parsed_target.netloc
        )
        filtered_headers = {
            k: v for k, v in req_headers.items() if k.lower() not in ("content-length",)
        }

        timeout = httpx.Timeout(connect=30.0, read=300.0, write=60.0, pool=60.0)
        limits = httpx.Limits(max_keepalive_connections=10, max_connections=30, keepalive_expiry=60.0)
        client = httpx.AsyncClient(timeout=timeout, limits=limits)
        req = client.build_request(
            method=request.method,
            url=target_url,
            content=body,
            headers=filtered_headers,
        )
        try:
            upstream_resp = await client.send(req, stream=True)
        except Exception as forward_err:
            await client.aclose()
            err_payload = json.dumps(
                {"error": f"Failed to connect to upstream endpoint ({target_url}): {forward_err}"}
            ).encode("utf-8")
            return StreamingResponse(
                iter([err_payload]), status_code=502, media_type="application/json"
            )

        async def body_stream():
            try:
                async for chunk in upstream_resp.aiter_bytes():
                    yield chunk
            except (httpx.HTTPError, Exception) as stream_err:
                logger.warning(f"Upstream stream interrupted ({target_url}): {stream_err}")
            finally:
                try:
                    await upstream_resp.aclose()
                except Exception:
                    pass
                try:
                    await client.aclose()
                except Exception:
                    pass

        resp_headers = {
            k: v
            for k, v in upstream_resp.headers.items()
            if k.lower() not in ("content-length", "content-encoding", "transfer-encoding")
        }
        return StreamingResponse(
            body_stream(), status_code=upstream_resp.status_code, headers=resp_headers
        )

    app = Starlette(
        routes=[Route("/{path:path}", proxy_handler, methods=["GET", "POST", "PUT", "DELETE"])]
    )
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
    server = uvicorn.Server(config)

    server_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)

    port = server.servers[0].sockets[0].getsockname()[1]
    proxy_url = f"http://127.0.0.1:{port}"
    return server, server_task, proxy_url


async def stream_with_antigravity_sdk(
    user_message: str,
    mcp_configs: list[MCPConfig],
    session_id: str = "default",
    current_dashboard_id: str | None = None,
    agent_id: str | None = "general",
    api_key: str = "",
    history: list[dict[str, str]] | None = None,
    scope: str | None = None,
    pin_id: int | None = None,
    widget_id: str | None = None,
    execution_ctx: ExecutionContext | None = None,
    base_url: str | None = None,
    model_override: str | None = None,
    parent_context: str = "",
    parent_session_id: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    from google.antigravity import (
        LocalAgentConfig,
        LocalOpenAIAgentConfig,
        Agent,
        CustomSystemInstructions,
        CompactionConfig,
    )
    from google.antigravity.models import ModelTarget, GeminiAPIEndpoint
    from google.antigravity.types import (
        McpStreamableHttpServer,
        Thought,
        Text,
        ToolCall,
        ToolResult,
        SessionContinuationMode,
        RetryConfig,
        ModelAPIRetryConfig,
        StepStatus,
    )
    from backend.app.auth import decrypt_secret

    dash_context, active_widgets, active_comments, _ = get_dashboard_context(current_dashboard_id)
    history_context = session_store.format_sqlite_history(history)
    combined_instructions = build_layered_system_prompt(
        agent_id=agent_id,
        dashboard_id=current_dashboard_id,
        scope=scope,
        pin_id=pin_id,
        widget_id=widget_id,
        history_context=history_context,
        parent_context=parent_context,
        parent_session_id=parent_session_id,
    )

    emitted_canvas_actions: list[dict[str, Any]] = []
    emitted_proposals: list[dict[str, Any]] = []
    emitted_widget_ids: set[str] = set()
    tools = build_agent_tools(current_dashboard_id, emitted_canvas_actions, emitted_proposals)

    mcp_servers = []
    for cfg in mcp_configs:
        if cfg.is_active and cfg.url:
            decrypted_auth = decrypt_secret(cfg.auth_header) if cfg.auth_header else None
            headers = {"Authorization": decrypted_auth} if decrypted_auth else None
            is_valid = await check_mcp_streamable_valid(cfg.url, headers=headers)
            if not is_valid:
                continue
            clean_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", cfg.name or "mcp_server").strip("_") or "mcp_server"
            mcp_servers.append(
                McpStreamableHttpServer(name=clean_name, url=cfg.url, headers=headers)
            )

    conv_id = session_store.get_antigravity_conversation_id(session_id)
    session_store.set_sdk_session_id(session_id, "antigravity", conv_id)

    effective_base_url = (base_url or ANTIGRAVITY_BASE_URL or "").strip()
    effective_model = (model_override or ANTIGRAVITY_MODEL or "gemini-3.5-flash").strip()
    effective_api_key = (api_key or ANTIGRAVITY_API_KEY or OPENAI_API_KEY or "").strip()

    is_gemini_endpoint = (
        bool(effective_base_url)
        and ("googleapis.com" in effective_base_url.lower() or "generativelanguage" in effective_base_url.lower())
        and "v1/chat" not in effective_base_url.lower()
    )

    auth_proxy_server = None
    auth_proxy_task = None
    resolved_base_url = effective_base_url

    try:
        if effective_base_url and not is_gemini_endpoint and effective_api_key:
            try:
                auth_proxy_server, auth_proxy_task, resolved_base_url = await start_auth_proxy(
                    effective_base_url, effective_api_key
                )
            except Exception as proxy_err:
                logger.warning(f"Notice starting loopback auth proxy: {proxy_err}")
                resolved_base_url = effective_base_url

        if effective_base_url:
            models_to_try: list[str] = [effective_model]
        else:
            primary_model = effective_model
            models_to_try = [primary_model]
            for fb_model in ("gemini-2.5-flash", "gemini-3.5-flash-lite"):
                if fb_model not in models_to_try:
                    models_to_try.append(fb_model)

        collected_text: list[str] = []
        last_step_error: str | None = None
        last_stop_reason_str: str = ""

        for attempt_idx, model_name in enumerate(models_to_try):
            if execution_ctx is not None and execution_ctx.is_cancelled:
                break

            attempt_conv_id = conv_id if attempt_idx == 0 else f"{conv_id[:56]}_fb{attempt_idx}"

            if effective_base_url:
                if is_gemini_endpoint:
                    config = LocalAgentConfig(
                        models=[
                            ModelTarget(
                                name=model_name,
                                endpoint=GeminiAPIEndpoint(
                                    base_url=effective_base_url,
                                    api_key=effective_api_key or None,
                                ),
                            )
                        ],
                        system_instructions=CustomSystemInstructions(text=combined_instructions),
                        tools=tools,
                        mcp_servers=mcp_servers,
                        workspaces=[str(REPOS_DIR)],
                        conversation_id=attempt_conv_id,
                        session_continuation_mode=SessionContinuationMode.CREATE_OR_RESUME,
                        save_dir=session_store.antigravity_save_dir,
                        app_data_dir=session_store.antigravity_app_data_dir,
                        retry_config=RetryConfig(
                            api_retry=ModelAPIRetryConfig(
                                max_retries=4,
                                initial_sleep_duration_ms=3000,
                                exponential_multiplier=1.5,
                            )
                        ),
                        compaction_config=CompactionConfig(),
                    )
                else:
                    # OpenAI-compatible completions API (DeepSeek, Ollama, LM Studio, vLLM, etc.)
                    env_vars: dict[str, str] = {}
                    if effective_api_key:
                        env_vars["OPENAI_API_KEY"] = effective_api_key
                        env_vars["DEEPSEEK_API_KEY"] = effective_api_key
                    config = LocalOpenAIAgentConfig(
                        model=model_name,
                        base_url=resolved_base_url,
                        system_instructions=CustomSystemInstructions(text=combined_instructions),
                        tools=tools,
                        mcp_servers=mcp_servers,
                        workspaces=[str(REPOS_DIR)],
                        conversation_id=attempt_conv_id,
                        session_continuation_mode=SessionContinuationMode.CREATE_OR_RESUME,
                        save_dir=session_store.antigravity_save_dir,
                        app_data_dir=session_store.antigravity_app_data_dir,
                        retry_config=RetryConfig(
                            api_retry=ModelAPIRetryConfig(
                                max_retries=3,
                                initial_sleep_duration_ms=2000,
                                exponential_multiplier=1.5,
                            )
                        ),
                        compaction_config=CompactionConfig(),
                        env=env_vars,
                    )
            else:
                config = LocalAgentConfig(
                    system_instructions=CustomSystemInstructions(text=combined_instructions),
                    model=model_name,
                    api_key=effective_api_key or None,
                    tools=tools,
                    mcp_servers=mcp_servers,
                    workspaces=[str(REPOS_DIR)],
                    conversation_id=attempt_conv_id,
                    session_continuation_mode=SessionContinuationMode.CREATE_OR_RESUME,
                    save_dir=session_store.antigravity_save_dir,
                    app_data_dir=session_store.antigravity_app_data_dir,
                    retry_config=RetryConfig(
                        api_retry=ModelAPIRetryConfig(
                            max_retries=4,
                            initial_sleep_duration_ms=3000,
                            exponential_multiplier=1.5,
                        )
                    ),
                    compaction_config=CompactionConfig(),
                )

            last_step_error = None
            has_gated_pause = False
            try:
                async with Agent(config) as agent:
                    chat_resp = await agent.chat(user_message)

                    if execution_ctx is not None:
                        execution_ctx.add_cancel_callback(chat_resp.cancel)

                    try:
                        async for chunk in chat_resp.chunks:
                            if execution_ctx is not None and execution_ctx.is_cancelled:
                                break

                            if isinstance(chunk, Thought):
                                thought_str = getattr(chunk, "text", getattr(chunk, "thought", ""))
                                if thought_str:
                                    yield {"type": "thought", "content": thought_str}
                            elif isinstance(chunk, ToolCall):
                                yield {"type": "tool_call", "name": chunk.name, "args": chunk.args}
                            elif isinstance(chunk, ToolResult):
                                yield {"type": "tool_result", "name": chunk.name, "result": chunk.result}
                                while emitted_canvas_actions:
                                    action_ev = emitted_canvas_actions.pop(0)
                                    w_id = action_ev.get("widget", {}).get("id")
                                    if w_id:
                                        emitted_widget_ids.add(w_id)
                                    yield action_ev
                                while emitted_proposals:
                                    yield emitted_proposals.pop(0)
                                    has_gated_pause = True

                                res_dict = chunk.result if isinstance(chunk.result, dict) else {}
                                res_status = str(res_dict.get("status", "")).lower()
                                if res_status in (
                                    "approval_requested",
                                    "proposal_created",
                                    "question_asked",
                                    "awaiting_user_approval",
                                ):
                                    has_gated_pause = True

                                if has_gated_pause:
                                    # Antigravity Human-in-the-Loop Gating:
                                    # Halt the turn immediately so the model does not generate trailing
                                    # speculative chatter or duplicate questions.
                                    try:
                                        chat_resp.cancel()
                                    except Exception:
                                        pass
                                    break
                            elif isinstance(chunk, Text):
                                if chunk.text:
                                    collected_text.append(chunk.text)
                                    yield {"type": "token", "content": chunk.text}
                    except Exception as chunk_err:
                        logger.warning(f"Notice during chunk stream ({model_name}): {chunk_err}")
                        last_step_error = str(chunk_err)

                    while emitted_canvas_actions:
                        action_ev = emitted_canvas_actions.pop(0)
                        w_id = action_ev.get("widget", {}).get("id")
                        if w_id:
                            emitted_widget_ids.add(w_id)
                        yield action_ev
                    while emitted_proposals:
                        yield emitted_proposals.pop(0)

                    # Inspect conversation steps for any platform or model errors
                    conv = getattr(agent, "_conversation", None)
                    if conv and hasattr(conv, "_steps"):
                        for step in reversed(conv._steps):
                            if getattr(step, "status", None) == StepStatus.ERROR or getattr(step, "error", None):
                                last_step_error = str(getattr(step, "error", "") or "Model provider error")
                                break

                    stop_reason = getattr(chat_resp, "stop_reason", None)
                    last_stop_reason_str = str(stop_reason) if stop_reason else ""
            except Exception as init_err:
                logger.warning(f"Failed to execute agent ({model_name}): {init_err}")
                last_step_error = str(init_err)

            # If we got output, widgets, proposals, or paused for approval, stop trying fallbacks
            if collected_text or emitted_widget_ids or emitted_proposals or has_gated_pause or (execution_ctx and execution_ctx.is_cancelled):
                break

            # If no output and transient/model error occurred, try next fallback model
            err_lower = (last_step_error or "").lower()
            is_retriable = any(
                k in err_lower or k in last_stop_reason_str.lower()
                for k in ("503", "429", "404", "demand", "unavailable", "quota", "not found", "overloaded")
            )
            if is_retriable and attempt_idx + 1 < len(models_to_try):
                next_model = models_to_try[attempt_idx + 1]
                yield {
                    "type": "thought",
                    "content": f"Model `{model_name}` experienced high demand; switching to fallback `{next_model}`...",
                }
                continue
            break
    finally:
        if auth_proxy_server is not None:
            auth_proxy_server.should_exit = True
            if auth_proxy_task is not None:
                try:
                    await asyncio.wait_for(auth_proxy_task, timeout=0.8)
                except Exception:
                    pass

    if not collected_text and not emitted_widget_ids and not emitted_proposals:
        if "QUOTA" in last_stop_reason_str or (last_step_error and ("429" in last_step_error or "quota" in last_step_error.lower())):
            err_msg = (
                "⚠️ **Model Provider Rate Limit (HTTP 429)**\n\n"
                f"The upstream rate limit for `{effective_model}` was reached. "
                "Please wait about 30–60 seconds and submit your request again."
            )
        elif last_step_error and ("503" in last_step_error or "demand" in last_step_error.lower() or "unavailable" in last_step_error.lower()):
            err_msg = (
                "⚠️ **Model Provider Notice (HTTP 503)**\n\n"
                f"The model endpoint (`{effective_model}`" + (f" at `{effective_base_url}`" if effective_base_url else "") + ") is temporarily unavailable or experiencing high demand. "
                "Please wait a few moments and try sending your prompt again."
            )
        elif last_step_error:
            err_msg = f"⚠️ **Model Provider Notice**: {last_step_error}\n\nPlease verify your endpoint configuration and retry your prompt."
        else:
            err_msg = (
                "⚠️ **No response received from agent**\n\n"
                f"The model endpoint (`{effective_model}`) did not generate output. Please check your configuration and try again."
            )
        yield {"type": "token", "content": err_msg}
    elif last_step_error:
        if "503" in last_step_error or "demand" in last_step_error.lower() or "unavailable" in last_step_error.lower():
            notice = "\n\n*(Notice: Upstream provider experienced temporary high demand (HTTP 503). If information is incomplete, please resend your prompt.)*"
            yield {"type": "token", "content": notice}
        elif "429" in last_step_error or "quota" in last_step_error.lower():
            notice = "\n\n*(Notice: Upstream rate limit reached (HTTP 429). Please wait a moment before sending follow-up messages.)*"
            yield {"type": "token", "content": notice}

    full_text = "".join(collected_text)
    for extra_action in extract_and_persist_canvas_actions(
        full_text=full_text,
        current_dashboard_id=current_dashboard_id,
        active_widgets=active_widgets,
        active_comments=active_comments,
        provider_label="Google Antigravity SDK",
        already_emitted_ids=emitted_widget_ids,
    ):
        yield extra_action

    yield {"type": "done"}
