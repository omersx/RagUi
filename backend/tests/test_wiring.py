"""Pytest suite for wiring + registry guards (no DB required)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.schemas import ChatConfig
from app.utils.model_registry import (
    MODEL_DIMENSIONS,
    get_chunk_table_name,
    sanitize_model_name,
)


def test_all_api_routes_registered():
    paths = set(app.openapi()["paths"].keys())
    expected = {
        "/api/chat",
        "/api/health",
        "/api/ingest",
        "/api/knowledge/files",
        "/api/knowledge/stats",
        "/api/sessions",
        "/api/sessions/{session_id}",
        "/api/sessions/{session_id}/messages",
        "/api/test-key",
    }
    assert expected.issubset(paths)


@pytest.mark.parametrize(
    "model,table",
    [
        ("all-MiniLM-L6-v2", "chunks_all_minilm_l6_v2"),
        ("text-embedding-3-small", "chunks_text_embedding_3_small"),
        ("bge-small-en-v1.5", "chunks_bge_small_en_v1_5"),
    ],
)
def test_table_names(model, table):
    assert get_chunk_table_name(model) == table


def test_custom_model_names_are_sanitized_safely():
    from app.utils.model_registry import get_chunk_table_name, sanitize_model_name

    # OpenRouter-style names with slashes/dots/colons must become safe identifiers
    assert (
        get_chunk_table_name("meta-llama/llama-3.2-3b-instruct:free")
        == "chunks_meta_llama_llama_3_2_3b_instruct_free"
    )


@pytest.mark.parametrize(
    "evil",
    [
        "",
        "   ",
        "x" * 60,  # exceeds MAX_SUFFIX_LEN after sanitize
    ],
)
def test_unsafe_names_raise(evil):
    from app.utils.model_registry import get_chunk_table_name

    with pytest.raises(ValueError):
        get_chunk_table_name(evil)


@pytest.mark.parametrize(
    "hostile",
    [
        'evil"; DROP TABLE users; --',
        "all-MiniLM-L6-v2' OR 1=1 --",
        "../../etc/passwd",
        "$(rm -rf /)",
        "model\x00name",
        "unicode-éè模型",
        "a;b;c|d&e%f$g#h@i!j(k)l*m+n=o~p`q",
    ],
)
def test_hostile_names_never_produce_unsafe_identifiers(hostile):
    """Core injection invariant: sanitize either raises or returns [a-z0-9_] only."""
    import re

    from app.utils.model_registry import sanitize_model_name

    try:
        suffix = sanitize_model_name(hostile)
    except ValueError:
        return  # raising is acceptable
    assert re.fullmatch(r"[a-z0-9_]{1,50}", suffix), f"unsafe suffix survived: {suffix!r}"


def test_local_whitelist_still_enforced():
    from app.utils.model_registry import validate_local_model

    with pytest.raises(ValueError):
        validate_local_model("some-random-local-model")
    validate_local_model("all-MiniLM-L6-v2")  # does not raise


def test_sanitize_output_is_safe_identifier():
    for model in MODEL_DIMENSIONS:
        suffix = sanitize_model_name(model)
        assert suffix.replace("_", "").isalnum(), suffix


def test_chat_config_defaults_and_bounds():
    cfg = ChatConfig()
    assert cfg.top_k == 5
    assert cfg.temperature == 0.7
    assert cfg.embedding_model == "all-MiniLM-L6-v2"
    assert cfg.llm_provider == "local"

    with pytest.raises(ValidationError):
        ChatConfig(top_k=999)
    with pytest.raises(ValidationError):
        ChatConfig(temperature=-1)
    with pytest.raises(ValidationError):
        ChatConfig(llm_provider="quantum")

    assert ChatConfig.model_validate({"top_k": 3}).top_k == 3
