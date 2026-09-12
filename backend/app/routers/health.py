"""Health check + OpenAI key tester."""
from __future__ import annotations

import httpx
from fastapi import APIRouter

from ..config import get_settings
from ..database import pool
from ..models.schemas import TestKeyRequest
from ..services.embedder import loaded_local_models
from ..services.entities import queue_depth

router = APIRouter()


@router.get("/health")
async def health():
    settings = get_settings()

    database = "connected"
    try:
        async with pool().acquire() as conn:
            await conn.execute("SELECT 1")
    except Exception:
        database = "unavailable"

    ollama = "unavailable"
    available_models: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
            if resp.status_code == 200:
                ollama = "available"
                available_models = [m["name"] for m in resp.json().get("models", [])]
    except Exception:
        pass

    return {
        "status": "healthy" if database == "connected" else "degraded",
        "database": database,
        "ollama": ollama,
        "ollama_models": available_models,
        "loaded_models": loaded_local_models(),
        "entities": await queue_depth(),
    }


@router.post("/test-key")
async def test_key(body: TestKeyRequest):
    """Validate an API key against OpenAI or any OpenAI-compatible endpoint."""
    base_url = body.base_url.strip()
    if base_url:
        # Only real endpoints: block file://, gopher://, and other exotic schemes.
        if not base_url.lower().startswith(("http://", "https://")):
            return {
                "valid": False,
                "message": "Base URL must start with http:// or https://.",
            }
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=body.api_key, base_url=base_url or None)
        models = await client.models.list()
        ids = sorted({m.id for m in models.data})[:20]
        return {"valid": True, "message": "API key is valid.", "sample_models": ids}
    except Exception as exc:
        detail = getattr(exc, "message", None) or str(exc)
        return {"valid": False, "message": f"Invalid key or unreachable: {detail}"}
