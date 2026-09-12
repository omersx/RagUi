"""Tests for phase-3 entity extraction pure logic (no DB / LLM required)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.schemas import ChatConfig
from app.services.entities import (
    _give_up,
    _semaphore,
    _with_retries,
    batch_chunks,
    coerce_type,
    job_params,
    normalize_name,
    parse_extraction_json,
)


def test_normalize_strips_articles_punctuation_and_case():
    assert normalize_name("The Quarterly Report!") == "quarterly report"
    assert normalize_name("  A  committee ") == "committee"
    assert normalize_name("An  AI-driven  Tool") == "aidriven tool"
    assert normalize_name("") == ""


def test_coerce_type_falls_back_to_concept():
    assert coerce_type("person") == "person"
    assert coerce_type(" PERSON ") == "person"
    assert coerce_type("spaceship") == "concept"
    assert coerce_type(None) == "concept"


def test_parse_valid_json():
    raw = '{"entities": [{"name": "Acme Corp", "type": "organization"}], "relations": [{"source": "Acme Corp", "target": "Q3 Report", "label": "published", "confidence": 0.9}]}'
    res = parse_extraction_json(raw)
    assert len(res.entities) == 1
    assert res.entities[0].name == "Acme Corp"
    assert res.entities[0].type == "organization"
    assert len(res.relations) == 1
    assert res.relations[0].label == "published"
    assert res.relations[0].confidence == 0.9


def test_parse_code_fences_and_junk():
    raw = 'Here you go:\n```json\n{"entities": [{"name": "Ada", "type": "person"}], "relations": []}\n```'
    res = parse_extraction_json(raw)
    assert [e.name for e in res.entities] == ["Ada"]
    assert parse_extraction_json("not json at all").entities == []
    assert parse_extraction_json("").relations == []


def test_parse_drops_invalid_items_but_keeps_valid():
    raw = (
        '{"entities": [{"name": "  ", "type": "person"}, {"name": "Ada", "type": "wizard"}], '
        '"relations": [{"source": "Ada", "target": "", "label": "met"}, '
        '{"source": "Ada", "target": "Bob", "label": "  Mentored  ", "confidence": "high"}]}'
    )
    res = parse_extraction_json(raw)
    assert [e.name for e in res.entities] == ["Ada"]
    assert res.entities[0].type == "concept"  # unknown type coerced
    assert len(res.relations) == 1
    assert res.relations[0].label == "mentored"
    assert res.relations[0].confidence == 0.8  # unparsable confidence defaulted


def test_job_params_never_persist_api_keys():
    cfg = ChatConfig(
        llm_provider="api",
        llm_model="gpt-4o-mini",
        llm_base_url="https://api.openai.com/v1",
        api_key="sk-super-secret",
    )
    params = job_params(cfg)
    assert params == {
        "llm_provider": "api",
        "llm_model": "gpt-4o-mini",
        "llm_base_url": "https://api.openai.com/v1",
    }
    assert "api_key" not in params
    assert "sk-super-secret" not in str(params)


def test_give_up_boundaries():
    assert _give_up(1) is False
    assert _give_up(3) is False
    assert _give_up(4) is True


def test_batch_chunks_respects_char_budget():
    chunks = [(1, "a" * 5000), (2, "b" * 5000), (3, "c" * 100)]
    batches = batch_chunks(chunks)
    # 5000+5000 exceeds the 6000 budget; chunk 3 (100) joins chunk 2's batch.
    assert len(batches) == 2
    assert batches[0] == [(1, "a" * 5000)]
    assert batches[1] == [(2, "b" * 5000), (3, "c" * 100)]


async def check_retry_succeeds_first_try_without_sleeping():
    calls = []
    sleeps = []

    async def fn():
        calls.append(1)
        return '{"entities": []}'

    async def fake_sleep(s):
        sleeps.append(s)

    out = await _with_retries("t", fn, attempts=3, sleep=fake_sleep)
    assert out == '{"entities": []}'
    assert len(calls) == 1
    assert sleeps == []


async def check_retry_backoff_then_success():
    calls = []
    sleeps = []

    async def fn():
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("boom")
        return "data"

    async def fake_sleep(s):
        sleeps.append(s)

    out = await _with_retries("t", fn, attempts=3, base_delay=2.0, sleep=fake_sleep)
    assert out == "data"
    assert len(calls) == 3
    assert sleeps == [2.0, 4.0]


async def check_retry_treats_empty_output_as_failure_and_exhausts():
    calls = []

    async def fn():
        calls.append(1)
        return "   "

    async def fake_sleep(s):
        pass

    out = await _with_retries("t", fn, attempts=3, sleep=fake_sleep)
    assert out == ""
    assert len(calls) == 3


async def check_semaphore_caps_concurrent_sections():
    sem = _semaphore(limit=2)
    current = 0
    peak = 0

    async def worker():
        nonlocal current, peak
        async with sem:
            current += 1
            peak = max(peak, current)
            await asyncio.sleep(0.01)
            current -= 1

    await asyncio.gather(*[worker() for _ in range(6)])
    assert peak == 2


def test_async_retry_and_semaphore():
    # pytest-asyncio is not a dependency — drive coroutines explicitly.
    for check in (
        check_retry_succeeds_first_try_without_sleeping,
        check_retry_backoff_then_success,
        check_retry_treats_empty_output_as_failure_and_exhausts,
        check_semaphore_caps_concurrent_sections,
    ):
        asyncio.run(check())
