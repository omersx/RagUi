"""Async Postgres pool + schema bootstrap + dynamic per-model chunk tables."""
from __future__ import annotations

import asyncpg

from .config import get_settings
from .utils.logger import get_logger

log = get_logger(__name__)

_pool: asyncpg.Pool | None = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialised — call init_db() first.")
    return _pool


CORE_DDL = [
    """
    CREATE TABLE IF NOT EXISTS uploaded_files (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        file_hash VARCHAR(64) NOT NULL UNIQUE,
        file_size_bytes BIGINT,
        mime_type VARCHAR(100),
        raw_markdown TEXT,
        total_chunks INTEGER DEFAULT 0,
        embedding_model VARCHAR(100),
        status VARCHAR(20) DEFAULT 'processing',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) DEFAULT 'New Chat',
        embedding_model VARCHAR(100) NOT NULL,
        llm_model VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        retrieved_chunk_ids INTEGER[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS embedding_model_registry (
        id SERIAL PRIMARY KEY,
        model_name VARCHAR(100) UNIQUE NOT NULL,
        provider VARCHAR(20) NOT NULL,
        dimensions INTEGER NOT NULL,
        table_name VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
]


def chunk_table_ddl(table: str, dims: int) -> list[str]:
    return [
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            content_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
            source_file_id INTEGER REFERENCES uploaded_files(id) ON DELETE CASCADE,
            page_range INT[],
            heading_hierarchy TEXT[],
            token_count INTEGER,
            embedding VECTOR({dims}) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        f"""
        CREATE INDEX IF NOT EXISTS idx_{table}_hnsw
        ON {table}
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        """,
        # Keyword (BM25-style) search index — see Supabase hybrid-search pattern
        f"CREATE INDEX IF NOT EXISTS idx_{table}_fts ON {table} USING gin (content_tsv)",
    ]


# Idempotent upgrade statements for chunk tables created before hybrid search.
_schema_upgrades = {
    "tsv_column": (
        "ALTER TABLE {table} ADD COLUMN IF NOT EXISTS content_tsv "
        "TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED"
    ),
    "fts_index": "CREATE INDEX IF NOT EXISTS idx_{table}_fts ON {table} USING gin (content_tsv)",
}

_migrated_tables: set[str] = set()


async def ensure_chunk_schema(table: str) -> None:
    """Bring an existing chunk table up to the current shape (once per process)."""
    if table in _migrated_tables:
        return
    async with pool().acquire() as conn:
        for ddl in _schema_upgrades.values():
            await conn.execute(ddl.format(table=table))
    _migrated_tables.add(table)


async def init_db() -> None:
    global _pool
    settings = get_settings()
    if _pool is None:
        _pool = await asyncpg.create_pool(dsn=settings.asyncpg_dsn, min_size=1, max_size=10)
    async with _pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        for ddl in CORE_DDL:
            await conn.execute(ddl)
    log.info("database.initialised", environment=settings.environment)


async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def ensure_chunk_table(model: str, dimensions: int | None = None) -> str:
    """Create (or fetch) the vector table for this model.

    Whitelisted models use their known dimensions; custom models MUST receive
    `dimensions` (from config or a probe). The name is SQL-sanitized either way.
    """
    from .utils.model_registry import (
        MODEL_DIMENSIONS,
        get_chunk_table_name,
        sanitize_model_name,
    )

    sanitize_model_name(model)  # raises before any SQL for unsafe names
    table = get_chunk_table_name(model)
    dims = MODEL_DIMENSIONS.get(model) or dimensions
    if not dims or dims <= 0:
        raise ValueError(f"Cannot resolve embedding dimensions for {model!r}.")
    async with pool().acquire() as conn:
        exists = await conn.fetchrow(
            "SELECT model_name FROM embedding_model_registry WHERE model_name = $1", model
        )
        if exists is None:
            for ddl in chunk_table_ddl(table, dims):
                await conn.execute(ddl)
            await ensure_chunk_schema(table)
            provider = "local" if model in ("all-MiniLM-L6-v2", "all-mpnet-base-v2", "bge-small-en-v1.5") else "api"
            await conn.execute(
                """
                INSERT INTO embedding_model_registry (model_name, provider, dimensions, table_name)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (model_name) DO NOTHING
                """,
                model,
                provider,
                dims,
                table,
            )
            log.info("database.chunk_table_created", model=model, table=table, dimensions=dims)
        else:
            await ensure_chunk_schema(table)
    return table
