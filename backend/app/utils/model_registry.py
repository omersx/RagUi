"""Embedding model helpers + SQL-safe table-name derivation.

Whitelisted models get known dimensions; custom (user-supplied API) models are
allowed too — their names are sanitized to [a-z0-9_] so no injection can reach
SQL, and their vector dimensions are resolved at first use.
"""
from __future__ import annotations

import re

# Canonical model name -> embedding vector dimensions
MODEL_DIMENSIONS: dict[str, int] = {
    # Local (SentenceTransformers)
    "all-MiniLM-L6-v2": 384,
    "all-mpnet-base-v2": 768,
    "bge-small-en-v1.5": 384,
    # API (OpenAI)
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}

LOCAL_MODELS: list[str] = ["all-MiniLM-L6-v2", "all-mpnet-base-v2", "bge-small-en-v1.5"]
API_MODELS: list[str] = [
    "text-embedding-3-small",
    "text-embedding-3-large",
    "text-embedding-ada-002",
]

# SentenceTransformers model id -> HuggingFace tokenizer id (for Docling HybridChunker)
TOKENIZER_IDS: dict[str, str] = {
    "all-MiniLM-L6-v2": "sentence-transformers/all-MiniLM-L6-v2",
    "all-mpnet-base-v2": "sentence-transformers/all-mpnet-base-v2",
    "bge-small-en-v1.5": "BAAI/bge-small-en-v1.5",
}
FALLBACK_TOKENIZER_ID = "sentence-transformers/all-MiniLM-L6-v2"

_VALID_SUFFIX = re.compile(r"^[a-z0-9_]+$")

# Postgres identifiers cap at 63 bytes; leave room for the "chunks_" prefix
# and the "idx_<table>_hnsw" index name.
MAX_SUFFIX_LEN = 50


def sanitize_model_name(model: str) -> str:
    """Convert any model name into a SQL-safe table suffix.

    Works for whitelisted AND custom (user-supplied) names: everything outside
    [a-z0-9] collapses to underscores, so no quoting/injection can survive.
    """
    suffix = re.sub(r"[^a-z0-9]+", "_", model.strip().lower()).strip("_")
    if not suffix or not _VALID_SUFFIX.match(suffix):
        raise ValueError(f"Illegal characters in model name: {model!r}")
    if len(suffix) > MAX_SUFFIX_LEN:
        raise ValueError(
            f"Model name too long for table naming ({len(suffix)} > {MAX_SUFFIX_LEN}): {model!r}"
        )
    return suffix


def get_chunk_table_name(model: str) -> str:
    return f"chunks_{sanitize_model_name(model)}"


def get_dimensions(model: str) -> int:
    if model not in MODEL_DIMENSIONS:
        raise ValueError(f"No known dimensions for {model!r} — pass them explicitly.")
    return MODEL_DIMENSIONS[model]


def validate_local_model(model: str) -> None:
    """Whitelist check for LOCAL SentenceTransformers models only.

    Custom API models skip this (sanitize_model_name keeps them SQL-safe).
    """
    if model not in LOCAL_MODELS:
        raise ValueError(
            f"Unknown local embedding model {model!r}. Allowed: {sorted(LOCAL_MODELS)}"
        )


def tokenizer_id_for(model: str) -> str:
    return TOKENIZER_IDS.get(model, FALLBACK_TOKENIZER_ID)
