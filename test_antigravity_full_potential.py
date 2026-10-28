import base64
import json
from pathlib import Path
from google.antigravity.models import GeminiModelOptions, ThinkingLevel
from backend.app.services.agents.antigravity_runner import (
    resolve_thinking_level,
    parse_multimodal_attachment,
    format_usage_metadata,
)
from backend.app.routers.chat_routes import _parse_proposals_json, PromptPayload


def test_thinking_level_mapping():
    assert resolve_thinking_level("minimal") == ThinkingLevel.MINIMAL
    assert resolve_thinking_level("low") == ThinkingLevel.LOW
    assert resolve_thinking_level("medium") == ThinkingLevel.MEDIUM
    assert resolve_thinking_level("high") == ThinkingLevel.HIGH
    assert resolve_thinking_level("extra_high") == ThinkingLevel.EXTRA_HIGH
    assert resolve_thinking_level("extra-high") == ThinkingLevel.EXTRA_HIGH
    assert resolve_thinking_level(None) is None
    assert resolve_thinking_level("unknown") is None

    # Verify GeminiModelOptions with thinking level
    opt = GeminiModelOptions(thinking_level=ThinkingLevel.HIGH)
    assert opt.thinking_level == ThinkingLevel.HIGH
    print("✓ ThinkingLevel resolution and GeminiModelOptions verified")


def test_multimodal_attachment_parsing(tmp_path: Path):
    # Test base64 image data URL
    fake_png_header = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b64_png = base64.b64encode(fake_png_header).decode("utf-8")
    data_url = f"data:image/png;base64,{b64_png}"

    img_att = {
        "name": "screenshot.png",
        "mime_type": "image/png",
        "data": data_url,
    }
    parsed_img = parse_multimodal_attachment(img_att)
    assert parsed_img is not None
    assert parsed_img.mime_type == "image/png"
    assert parsed_img.data == fake_png_header
    assert parsed_img.description == "screenshot.png"

    # Test text / document attachment
    text_content = "SELECT * FROM read_csv('data.csv');"
    b64_text = base64.b64encode(text_content.encode("utf-8")).decode("utf-8")
    doc_att = {
        "name": "query.sql",
        "mime_type": "text/plain",
        "data": b64_text,
    }
    parsed_doc = parse_multimodal_attachment(doc_att)
    assert parsed_doc is not None
    assert parsed_doc.data == text_content.encode("utf-8")
    assert parsed_doc.description == "query.sql"

    print("✓ Multimodal attachments (images & documents) parsing verified")


def test_usage_metadata_formatting():
    from google.antigravity.types import UsageMetadata

    um = UsageMetadata(
        prompt_token_count=150,
        candidates_token_count=80,
        thoughts_token_count=45,
        cached_content_token_count=20,
        total_token_count=295,
    )
    formatted = format_usage_metadata(um)
    assert formatted == {
        "prompt_tokens": 150,
        "candidates_tokens": 80,
        "thoughts_tokens": 45,
        "cached_tokens": 20,
        "total_tokens": 295,
    }
    assert format_usage_metadata(None) is None
    print("✓ UsageMetadata telemetry formatting verified")


def test_metadata_persistence_and_parsing():
    sample_json = json.dumps({
        "proposals": [{"id": "p1", "type": "dataset", "table_name": "t1"}],
        "inquiries": [{"id": "i1", "question": "Approve push?"}],
        "usage": {
            "prompt_tokens": 120,
            "candidates_tokens": 60,
            "thoughts_tokens": 30,
            "cached_tokens": 10,
            "total_tokens": 220,
        },
        "attachments": [{"name": "diag.png", "mime_type": "image/png"}],
    })

    props, inqs, usage, atts = _parse_proposals_json(sample_json)
    assert props is not None and len(props) == 1
    assert inqs is not None and len(inqs) == 1
    assert usage is not None and usage["total_tokens"] == 220
    assert atts is not None and len(atts) == 1 and atts[0]["name"] == "diag.png"

    # Backward compatibility with list format
    legacy_list_json = json.dumps([{"type": "dataset", "table_name": "legacy"}])
    legacy_props, legacy_inqs, legacy_usage, legacy_atts = _parse_proposals_json(legacy_list_json)
    assert legacy_props is not None and len(legacy_props) == 1
    assert legacy_inqs is None
    assert legacy_usage is None
    assert legacy_atts is None

    print("✓ Message metadata parsing (backward-compatible) verified")


def test_prompt_payload_with_full_potential():
    payload = PromptPayload(
        message="Analyze this chart and error",
        thinking_level="extra_high",
        attachments=[
            {"name": "screenshot.png", "mime_type": "image/png", "data": "data:image/png;base64,ABC"}
        ],
    )
    assert payload.thinking_level == "extra_high"
    assert payload.attachments is not None
    assert len(payload.attachments) == 1
    print("✓ PromptPayload thinking_level & attachments models verified")


if __name__ == "__main__":
    import tempfile
    test_thinking_level_mapping()
    with tempfile.TemporaryDirectory() as td:
        test_multimodal_attachment_parsing(Path(td))
    test_usage_metadata_formatting()
    test_metadata_persistence_and_parsing()
    test_prompt_payload_with_full_potential()
    print("\nALL ANTIGRAVITY SDK FULL POTENTIAL TESTS PASSED 100%! 🚀")
