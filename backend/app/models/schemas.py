"""Pydantic request/response models."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChatConfig(BaseModel):
    llm_provider: Literal["local", "api", "custom"] = "local"
    llm_model: str = "llama3.2"
    llm_base_url: str = ""
    embedding_provider: Literal["local", "api", "custom"] = "local"
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_base_url: str = ""
    # 0 = auto (probe the endpoint once, then cache in the registry)
    embedding_dimensions: int = Field(default=0, ge=0, le=10000)
    api_key: str = ""
    top_k: int = Field(default=5, ge=1, le=50)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=64, le=8192)
    # Retrieval mode: semantic (vector only), fulltext (keyword/BM25-style),
    # hybrid (both lists fused with Reciprocal Rank Fusion), or graph
    # (entity-anchored hop walk with hybrid fallback — needs extracted entities).
    retrieval_mode: Literal["semantic", "hybrid", "fulltext", "graph"] = "hybrid"
    fulltext_weight: float = Field(default=1.0, ge=0.0, le=10.0)
    semantic_weight: float = Field(default=1.0, ge=0.0, le=10.0)
    rrf_k: int = Field(default=50, ge=1, le=1000)
    # GraphRAG: hop depth over the entity graph + max query-entity anchors.
    graph_depth: int = Field(default=2, ge=1, le=2)
    graph_max_entities: int = Field(default=6, ge=1, le=20)

    @property
    def llm_key(self) -> str:
        return self.api_key

    @property
    def is_custom_llm(self) -> bool:
        return self.llm_provider == "custom"


class TestKeyRequest(BaseModel):
    provider: Literal["api"] = "api"
    api_key: str = Field(min_length=1)
    base_url: str = ""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    messages: list[ChatMessage]
    config: ChatConfig = ChatConfig()


class ChunkOut(BaseModel):
    id: int
    content: str
    page_range: Optional[list[int]] = None
    heading_hierarchy: Optional[list[str]] = None
    token_count: Optional[int] = None
    similarity: Optional[float] = None
