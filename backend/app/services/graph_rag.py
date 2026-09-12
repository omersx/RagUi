"""GraphRAG v1 — entity-anchored retrieval with hybrid fallback.

Flow: match query entities by name (no LLM call) -> 1-2 hop relation walk ->
relation + mention chunks, capped at top_k. Anything missing (no entities
extracted, no name match, no chunks) falls back to hybrid search so answers
never come back empty for infrastructure reasons.
"""
from __future__ import annotations

from ..database import pool
from ..models.schemas import ChatConfig, ChunkOut
from ..utils.logger import get_logger
from .entities import normalize_name

log = get_logger(__name__)

CANDIDATE_CAP = 2000  # top entities by mentions considered for matching
REL_CAP_PER_HOP = 200
CHUNK_OVERFETCH = 2  # gather top_k * 2 candidates, then trim


# ------------------------------------------------------------ pure ----


def match_entities(
    query: str, candidates: list[tuple[int, str]], max_entities: int
) -> list[int]:
    """Match canonical entities by name. Pure — candidates are (id, normalized).

    Longest-first with subsumption: "quarterly report" wins and suppresses a
    separate "report" hit, so one concept yields one anchor.
    """
    q = normalize_name(query)
    if not q or not candidates or max_entities <= 0:
        return []
    ordered = sorted(candidates, key=lambda c: len(c[1]), reverse=True)
    kept_ids: list[int] = []
    kept_norms: list[str] = []
    for eid, norm in ordered:
        if not norm or norm not in q:
            continue
        if any(norm in longer for longer in kept_norms):
            continue
        kept_ids.append(eid)
        kept_norms.append(norm)
        if len(kept_ids) >= max_entities:
            break
    return kept_ids


# ------------------------------------------------------------ search ----


async def graph_search(query: str, table: str, config: ChatConfig) -> list[ChunkOut]:
    """Entity-anchored retrieval. Falls back to hybrid on any miss."""
    # Table name comes from our own registry via retrieve() — never user input.
    async with pool().acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM entities")
        if not total:
            return await _fallback(query, table, config, reason="no_entities")

        cand_rows = await conn.fetch(
            "SELECT id, normalized FROM entities ORDER BY mention_count DESC LIMIT $1",
            CANDIDATE_CAP,
        )
        matched = match_entities(
            query, [(int(r["id"]), r["normalized"]) for r in cand_rows], config.graph_max_entities
        )
        if not matched:
            return await _fallback(query, table, config, reason="no_match")

        # Hop 1: relations touching matched entities.
        rel_rows = await conn.fetch(
            "SELECT src_entity_id, dst_entity_id, chunk_id FROM relations "
            "WHERE src_entity_id = ANY($1::int[]) OR dst_entity_id = ANY($1::int[]) "
            "LIMIT $2",
            matched,
            REL_CAP_PER_HOP,
        )
        frontier = {int(r["src_entity_id"]) for r in rel_rows} | {
            int(r["dst_entity_id"]) for r in rel_rows
        }
        if config.graph_depth >= 2 and frontier:
            hop2 = await conn.fetch(
                "SELECT src_entity_id, dst_entity_id, chunk_id FROM relations "
                "WHERE (src_entity_id = ANY($1::int[]) OR dst_entity_id = ANY($1::int[])) "
                "AND NOT (src_entity_id = ANY($2::int[]) AND dst_entity_id = ANY($2::int[])) "
                "LIMIT $3",
                list(frontier),
                matched,
                REL_CAP_PER_HOP,
            )
            rel_rows = list(rel_rows) + list(hop2)

        # Chunk priority: relation-bearing chunks first, then bare mentions.
        rel_chunks = [int(r["chunk_id"]) for r in rel_rows if r["chunk_id"] is not None]
        mention_rows = await conn.fetch(
            "SELECT DISTINCT chunk_id FROM entity_mentions "
            "WHERE entity_id = ANY($1::int[]) AND chunk_id IS NOT NULL LIMIT $2",
            matched,
            config.top_k * CHUNK_OVERFETCH,
        )
        ordered: list[int] = []
        for cid in rel_chunks + [int(r["chunk_id"]) for r in mention_rows]:
            if cid not in ordered:
                ordered.append(cid)
        ordered = ordered[: config.top_k * CHUNK_OVERFETCH]
        if not ordered:
            return await _fallback(query, table, config, reason="no_chunks")

        from .retriever import row_to_chunk

        chunk_rows = await conn.fetch(
            f"SELECT id, content, page_range, heading_hierarchy, token_count "
            f"FROM {table} WHERE id = ANY($1::int[])",
            ordered,
        )
        by_id = {int(r["id"]): r for r in chunk_rows}
        results = [row_to_chunk(by_id[cid]) for cid in ordered if cid in by_id][: config.top_k]

    if not results:
        return await _fallback(query, table, config, reason="chunks_missing")
    log.info(
        "graphrag.results",
        matched=len(matched),
        relations=len(rel_rows),
        chunks=len(results),
        depth=config.graph_depth,
    )
    return results


async def _fallback(query: str, table: str, config: ChatConfig, reason: str) -> list[ChunkOut]:
    from .embedder import embed_texts
    from .retriever import hybrid_search, to_pg_vector

    log.info("graphrag.fallback", reason=reason)
    vectors = await embed_texts([query], config)
    return await hybrid_search(query, to_pg_vector(vectors[0]), table, config)
