"""Retrieval: semantic (pgvector), fulltext (tsvector/BM25-style), or hybrid (RRF).

Hybrid search follows the Supabase pattern:
  1. Run both searches separately as CTEs, each with row_number() ranks
     and candidate pools of least(match_count, 30) * 2.
  2. FULL OUTER JOIN them on id and fuse with Reciprocal Rank Fusion:
       score = sum over lists of weight / (rrf_k + rank_ix)
  3. Sort by score, limit match_count.

The table name is interpolated only from our own validated registry — never user input.
"""
from __future__ import annotations

from ..database import pool
from ..models.schemas import ChatConfig, ChunkOut
from ..services.embedder import embed_texts
from ..utils.logger import get_logger

log = get_logger(__name__)

MAX_CANDIDATES = 30  # per-list candidate pool cap (matches Supabase guidance)


def to_pg_vector(vec: list[float]) -> str:
    """Serialize a float vector into pgvector's text literal '[1,2,3]'."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


async def resolve_embedding_dimensions(config: ChatConfig) -> int:
    """Resolve vector size for a model: known whitelist → registry → config → probe."""
    from ..database import pool
    from ..utils.model_registry import MODEL_DIMENSIONS

    model = config.embedding_model
    if model in MODEL_DIMENSIONS:
        return MODEL_DIMENSIONS[model]

    async with pool().acquire() as conn:
        stored = await conn.fetchval(
            "SELECT dimensions FROM embedding_model_registry WHERE model_name = $1", model
        )
    if stored:
        return int(stored)

    if config.embedding_dimensions > 0:
        return config.embedding_dimensions

    from .embedder import probe_dimensions

    return await probe_dimensions(config)


async def _resolve_table(model: str, config: ChatConfig) -> str | None:
    """Return the validated chunk table for this model, creating it if needed.

    Returns None when the model can't be resolved (endpoint down / no dimensions).
    """
    from ..database import ensure_chunk_table

    try:
        dims = await resolve_embedding_dimensions(config)
        return await ensure_chunk_table(model, dimensions=dims)
    except Exception as exc:
        log.warning("retriever.table_resolve_failed", model=model, error=str(exc))
        return None


# ---------------------------------------------------------------- semantic ----

_SEMANTIC_SQL = """
    SELECT id, content, page_range, heading_hierarchy, token_count,
           1 - (embedding <=> $1::vector) AS similarity
    FROM {table}
    ORDER BY embedding <=> $1::vector
    LIMIT $2
"""


async def semantic_search(query_vector_str: str, table: str, top_k: int) -> list[ChunkOut]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(_SEMANTIC_SQL.format(table=table), query_vector_str, top_k)
    return [row_to_chunk(r) for r in rows]


# --------------------------------------------------------------- fulltext ----

_FULLTEXT_SQL = """
    SELECT id, content, page_range, heading_hierarchy, token_count,
           ts_rank_cd(content_tsv, websearch_to_tsquery('english', $1)) AS score
    FROM {table}
    WHERE content_tsv @@ websearch_to_tsquery('english', $1)
    ORDER BY score DESC
    LIMIT $2
"""


async def fulltext_search(query_text: str, table: str, top_k: int) -> list[ChunkOut]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(_FULLTEXT_SQL.format(table=table), query_text, top_k)
    return [row_to_chunk(r) for r in rows]


# ----------------------------------------------------------------- hybrid ----

_HYBRID_SQL = """
WITH ft AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q.tsq) DESC) AS rank_ix
    FROM {table},
         LATERAL (SELECT websearch_to_tsquery('english', $1) AS tsq) AS q
    WHERE content_tsv @@ q.tsq
    ORDER BY rank_ix
    LIMIT $2
),
sem AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector) AS rank_ix
    FROM {table}
    ORDER BY rank_ix
    LIMIT $2
),
fused AS (
    SELECT COALESCE(ft.id, sem.id) AS id,
           COALESCE(1.0 / ($4 + ft.rank_ix), 0.0) * $5 +
           COALESCE(1.0 / ($4 + sem.rank_ix), 0.0) * $6 AS score,
           ft.rank_ix AS ft_rank,
           sem.rank_ix AS sem_rank
    FROM ft
    FULL OUTER JOIN sem ON ft.id = sem.id
)
SELECT c.id, c.content, c.page_range, c.heading_hierarchy, c.token_count,
       fused.score,
       CASE WHEN fused.sem_rank IS NOT NULL
            THEN 1 - (c.embedding <=> $3::vector)
       END AS similarity,
       fused.ft_rank,
       fused.sem_rank
FROM fused
JOIN {table} c ON c.id = fused.id
ORDER BY fused.score DESC
LIMIT $7
"""


async def hybrid_search(
    query_text: str,
    query_vector_str: str,
    table: str,
    config: ChatConfig,
) -> list[ChunkOut]:
    k = min(config.top_k, MAX_CANDIDATES)
    pool_size = k * 2
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            _HYBRID_SQL.format(table=table),
            query_text,
            pool_size,
            query_vector_str,
            config.rrf_k,
            config.fulltext_weight,
            config.semantic_weight,
            k,
        )
    return [row_to_chunk(r) for r in rows]


# ------------------------------------------------------------------ shared ----


def row_to_chunk(r) -> ChunkOut:
    similarity = None
    try:
        raw_sim = r["similarity"]
        similarity = float(raw_sim) if raw_sim is not None else None
    except (KeyError, IndexError):
        pass
    return ChunkOut(
        id=r["id"],
        content=r["content"],
        page_range=list(r["page_range"]) if r["page_range"] else None,
        heading_hierarchy=list(r["heading_hierarchy"]) if r["heading_hierarchy"] else None,
        token_count=r["token_count"],
        similarity=similarity,
    )


async def retrieve(query: str, config: ChatConfig) -> list[ChunkOut]:
    """Dispatch on retrieval_mode. Returns [] when the model can't be resolved."""
    table = await _resolve_table(config.embedding_model, config)
    if table is None:
        log.info("retriever.no_table", model=config.embedding_model)
        return []

    mode = config.retrieval_mode
    if mode == "fulltext":
        results = await fulltext_search(query, table, config.top_k)
    elif mode == "graph":
        from .graph_rag import graph_search

        results = await graph_search(query, table, config)
    else:
        vectors = await embed_texts([query], config)
        vec = to_pg_vector(vectors[0])
        results = (
            await hybrid_search(query, vec, table, config)
            if mode == "hybrid"
            else await semantic_search(vec, table, config.top_k)
        )

    log.info("retriever.results", mode=mode, query_chars=len(query), hits=len(results))
    return results
