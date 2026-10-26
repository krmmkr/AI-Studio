import os
import asyncio
from unittest.mock import patch, MagicMock
from backend.app.config import ANTIGRAVITY_MODEL, ANTIGRAVITY_BASE_URL, ANTIGRAVITY_API_KEY
from backend.app.routers.chat_routes import PromptPayload, get_runtime_info
from backend.app.services.antigravity_agent import antigravity_agent
from backend.app.models import User
from google.antigravity import LocalOpenAIAgentConfig, LocalAgentConfig
from google.antigravity.models import GeminiAPIEndpoint, ModelTarget

def test_runtime_info():
    mock_user = MagicMock(spec=User)
    mock_user.id = 1
    
    with patch.dict(os.environ, {
        "ANTIGRAVITY_BASE_URL": "https://api.deepseek.com",
        "ANTIGRAVITY_MODEL": "deepseek-chat",
    }):
        info = get_runtime_info(current_user=mock_user)
        assert info["antigravity_model"] == "deepseek-chat"
        assert info["antigravity_base_url"] == "https://api.deepseek.com"
        agy_provider = next(p for p in info["providers"] if p["id"] == "antigravity")
        assert agy_provider["model"] == "deepseek-chat"
        assert agy_provider["base_url"] == "https://api.deepseek.com"
    print("✓ GET /api/chat/runtime reports custom Antigravity base_url and model")

def test_deepseek_openai_compatible_config():
    """Verify LocalOpenAIAgentConfig is correctly structured for DeepSeek / OpenAI-compatible APIs."""
    cfg = LocalOpenAIAgentConfig(
        model="deepseek-chat",
        base_url="https://api.deepseek.com",
        conversation_id="conv-12345678901234567890123456789012",
        env={"OPENAI_API_KEY": "sk-deepseek-test", "DEEPSEEK_API_KEY": "sk-deepseek-test"},
    )
    assert cfg.model == "deepseek-chat"
    assert cfg.base_url == "https://api.deepseek.com"
    assert cfg.env.get("DEEPSEEK_API_KEY") == "sk-deepseek-test"

    strategy = cfg.create_strategy(tool_runner=None, hook_runner=None)
    proto = strategy._build_harness_config()
    assert len(proto.models) == 1
    assert proto.models[0].name == "deepseek-chat"
    assert proto.models[0].gemma_endpoint.base_url == "https://api.deepseek.com"
    print("✓ DeepSeek OpenAI-compatible config & proto verified")

def test_ollama_local_config():
    """Verify LocalOpenAIAgentConfig is correctly structured for local Ollama instances."""
    cfg = LocalOpenAIAgentConfig(
        model="llama3.2",
        base_url="http://localhost:11434/v1",
        conversation_id="conv-12345678901234567890123456789012",
    )
    assert cfg.model == "llama3.2"
    assert cfg.base_url == "http://localhost:11434/v1"

    strategy = cfg.create_strategy(tool_runner=None, hook_runner=None)
    proto = strategy._build_harness_config()
    assert proto.models[0].name == "llama3.2"
    assert proto.models[0].gemma_endpoint.base_url == "http://localhost:11434/v1"
    print("✓ Local Ollama endpoint config & proto verified")

def test_custom_gemini_endpoint_config():
    """Verify LocalAgentConfig + GeminiAPIEndpoint for custom Gemini proxies."""
    cfg = LocalAgentConfig(
        models=[
            ModelTarget(
                name="gemini-custom",
                endpoint=GeminiAPIEndpoint(
                    base_url="https://generativelanguage.googleapis.com",
                    api_key="test-gemini-key",
                ),
            )
        ],
        conversation_id="conv-12345678901234567890123456789012",
    )
    assert cfg.models[0].name == "gemini-custom"
    assert cfg.models[0].endpoint.base_url == "https://generativelanguage.googleapis.com"
    assert cfg.models[0].endpoint.api_key == "test-gemini-key"
    print("✓ Custom Gemini proxy endpoint config verified")

async def test_runner_stream_graceful_handling():
    """Verify stream_with_antigravity_sdk executes with mock/custom endpoint gracefully."""
    from backend.app.services.agents.antigravity_runner import stream_with_antigravity_sdk
    
    events = []
    # Test with custom base_url that is not reachable: verifies graceful error yielding without crash
    async for event in stream_with_antigravity_sdk(
        user_message="Summarize",
        mcp_configs=[],
        session_id="test-session-custom-endpoint",
        base_url="http://127.0.0.1:59999/v1",
        model_override="deepseek-chat",
    ):
        events.append(event)
    
    assert len(events) > 0
    # Last event should be done or token notice
    assert any(ev.get("type") in ("token", "done") for ev in events)
    print("✓ Runner stream gracefully handled endpoint connection attempt")

if __name__ == "__main__":
    test_runtime_info()
    test_deepseek_openai_compatible_config()
    test_ollama_local_config()
    test_custom_gemini_endpoint_config()
    asyncio.run(test_runner_stream_graceful_handling())
    print("\nALL ANTIGRAVITY CUSTOM ENDPOINT & MODEL TESTS PASSED 100%! 🚀")
