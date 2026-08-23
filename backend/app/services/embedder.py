"""Embedding abstraction — local SentenceTransformers or any OpenAI-compatible API.

`api` targets OpenAI proper; `custom` targets any OpenAI-compatible endpoint
(OpenRouter, Together, Groq, LM Studio, …) via base_url override.
"""
from __future__ import annotations

import asyncio

from ..models.schemas import ChatConfig
from ..utils.logger import get_logger
from ..utils.model_registry import validate_local_model

log = get_logger(__name__)

# Cache of loaded SentenceTransformer models keyed by model name
_local_model_cache: dict[str, object] = {}

PROBE_TEXT = "dimension probe"


class LocalEmbedder:
    provider = "local"

    def __init__(self, model_name: str) -> None:
        validate_local_model(model_name)
        self.model_name = model_name

    def _load(self):
        if self.model_name not in _local_model_cache:
            from sentence_transformers import SentenceTransformer

            log.info("embedder.loading_local", model=self.model_name)
            _local_model_cache[self.model_name] = SentenceTransformer(
                self.model_name, device="cpu"
            )
        return _local_model_cache[self.model_name]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        model = await asyncio.to_thread(self._load)

        def encode():
            vectors = model.encode(
                texts,
                normalize_embeddings=True,
                show_progress_bar=False,
                convert_to_numpy=True,
            )
            return [v.tolist() for v in vectors]

        return await asyncio.to_thread(encode)


class APIEmbedder:
    provider = "api"

    def __init__(self, model_name: str, api_key: str, base_url: str = "") -> None:
        if not api_key:
            raise ValueError("An API key is required for API embedding models.")
        self.model_name = model_name
        self.api_key = api_key
        self.base_url = base_url.strip() or None

    def _client(self):
        from openai import AsyncOpenAI

        return AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        client = self._client()
        resp = await client.embeddings.create(model=self.model_name, input=texts)
        data = sorted(resp.data, key=lambda d: d.index)
        vectors = [d.embedding for d in data]
        if len({len(v) for v in vectors}) != 1:
            raise ValueError("Embedding endpoint returned inconsistent dimensions.")
        return vectors


def get_embedder(config: ChatConfig) -> LocalEmbedder | APIEmbedder:
    """Factory. Local models are whitelist-validated; custom names are SQL-sanitized later."""
    if config.embedding_provider == "local":
        return LocalEmbedder(config.embedding_model)
    return APIEmbedder(
        config.embedding_model,
        config.api_key,
        config.embedding_base_url,
    )


async def embed_texts(texts: list[str], config: ChatConfig) -> list[list[float]]:
    embedder = get_embedder(config)
    return await embedder.embed(texts)


async def probe_dimensions(config: ChatConfig) -> int:
    """Embed one probe string to discover the endpoint's vector size (custom models)."""
    vectors = await embed_texts([PROBE_TEXT], config)
    dims = len(vectors[0])
    log.info("embedder.probed_dims", model=config.embedding_model, dims=dims)
    return dims


def loaded_local_models() -> list[str]:
    return list(_local_model_cache.keys())
