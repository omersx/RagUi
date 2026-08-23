"""LLM generation with token streaming — Ollama (local) or OpenAI (API)."""
from __future__ import annotations

import json
from typing import AsyncGenerator

import httpx
from fastapi import HTTPException

from ..models.schemas import ChatConfig, ChatMessage
from ..utils.logger import get_logger

log = get_logger(__name__)

REQUEST_TIMEOUT = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)


def _chat_history(system_prompt: str, messages: list[ChatMessage]) -> list[dict]:
    return [{"role": "system", "content": system_prompt}] + [
        {"role": m.role, "content": m.content} for m in messages
    ]


async def _ollama_stream(config: ChatConfig, system_prompt: str, messages: list[ChatMessage]):
    from ..config import get_settings

    base = get_settings().ollama_base_url.rstrip("/")
    payload = {
        "model": config.llm_model,
        "messages": _chat_history(system_prompt, messages),
        "stream": True,
        "options": {"temperature": config.temperature, "num_predict": config.max_tokens},
    }
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        async with client.stream("POST", f"{base}/api/chat", json=payload) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                log.error("generator.ollama_error", status=resp.status_code, body=body[:500])
                raise HTTPException(status_code=502, detail=f"Ollama error {resp.status_code}")
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                data = json.loads(line)
                token = (data.get("message") or {}).get("content") or ""
                if token:
                    yield token
                if data.get("done"):
                    break


async def _openai_stream(config: ChatConfig, system_prompt: str, messages: list[ChatMessage]):
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=config.llm_key,
        # Custom OpenAI-compatible providers (OpenRouter, Groq, LM Studio, …)
        base_url=(config.llm_base_url.strip() or None),
    )
    stream = await client.chat.completions.create(
        model=config.llm_model,
        messages=_chat_history(system_prompt, messages),
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def generate_stream(
    system_prompt: str, messages: list[ChatMessage], config: ChatConfig
) -> AsyncGenerator[str, None]:
    """Yield response tokens one at a time."""
    if config.llm_provider == "local":
        stream = _ollama_stream(config, system_prompt, messages)
    else:
        if not config.llm_key:
            raise HTTPException(status_code=401, detail="An API key is required for this provider.")
        stream = _openai_stream(config, system_prompt, messages)

    async for token in stream:
        yield token


async def generate_once(prompt: str, config: ChatConfig) -> str:
    """Single-shot completion (used for session auto-titling)."""
    collected: list[str] = []
    msg = ChatMessage(role="user", content=prompt)
    try:
        async for token in generate_stream("", [msg], config):
            collected.append(token)
    except HTTPException as exc:
        log.warning("generator.once_failed", reason=str(exc.detail))
        return ""
    return "".join(collected)
