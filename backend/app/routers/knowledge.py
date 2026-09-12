"""Knowledge-base stats, file listing, deletion, graph data, and entities."""
from __future__ import annotations

import math
import time

from fastapi import APIRouter, HTTPException, Query

from ..database import pool
from ..models.schemas import ChatConfig
from ..services.entities import enqueue_extraction, is_extracting
from ..utils.logger import get_logger

router = APIRouter()
log = get_logger(__name__)

# Short-lived cache for the (expensive) graph endpoint. Mutations
# (ingest success, file delete) invalidate it; otherwise entries live 30s.
_graph_cache: dict[tuple, tuple[float, dict]] = {}
_GRAPH_CACHE_TTL = 30.0
_GRAPH_CACHE_MAX = 64
# SQL neighbor search always fetches links >= this floor; the caller's
# (higher) min_similarity is applied when deduping. The frontend fetches at
# the floor and filters client-side for instant slider response.
FETCH_SIM_FLOOR = 0.4


def invalidate_graph_cache() -> None:
    """Drop all cached graph payloads (call after ingest/delete)."""
    _graph_cache.clear()


# Entity-layer budgets (phase 3 graph layer).
ENTITY_NODE_LIMIT = 120
RELATION_EDGE_LIMIT = 300
MENTION_EDGE_LIMIT = 400


async def _fetch_entity_layer(conn, file_id: int | None):
    """Fetch canonical entities + their relations (optionally scoped to a file)."""
    if file_id is not None:
        entity_rows = await conn.fetch(
            "SELECT e.id, e.name, e.type, e.mention_count FROM entities e "
            "WHERE EXISTS (SELECT 1 FROM entity_mentions m "
            "              WHERE m.entity_id = e.id AND m.source_file_id = $1) "
            "ORDER BY e.mention_count DESC LIMIT $2",
            file_id,
            ENTITY_NODE_LIMIT,
        )
    else:
        entity_rows = await conn.fetch(
            "SELECT id, name, type, mention_count FROM entities "
            "ORDER BY mention_count DESC LIMIT $1",
            ENTITY_NODE_LIMIT,
        )
    total_entities = await conn.fetchval("SELECT COUNT(*) FROM entities")
    eids = [int(r["id"]) for r in entity_rows]
    rel_rows: list = []
    if eids:
        if file_id is not None:
            rel_rows = await conn.fetch(
                "SELECT src_entity_id, dst_entity_id, label FROM relations "
                "WHERE src_entity_id = ANY($1::int[]) AND dst_entity_id = ANY($1::int[]) "
                "AND source_file_id = $2 LIMIT $3",
                eids,
                file_id,
                RELATION_EDGE_LIMIT,
            )
        else:
            rel_rows = await conn.fetch(
                "SELECT src_entity_id, dst_entity_id, label FROM relations "
                "WHERE src_entity_id = ANY($1::int[]) AND dst_entity_id = ANY($1::int[]) "
                "LIMIT $2",
                eids,
                RELATION_EDGE_LIMIT,
            )
    return entity_rows, rel_rows, int(total_entities or 0)


def _append_entity_layer(nodes, edges, entity_rows, rel_rows, mention_rows, chunk_keys):
    """Append entity nodes + relates/mentions edges to a graph payload."""
    for r in entity_rows:
        nodes.append(
            {
                "id": f"e{r['id']}",
                "type": "entity",
                "label": (r["name"] or "")[:80],
                "entity_type": r["type"],
                "mention_count": r["mention_count"] or 0,
            }
        )
    eset = {f"e{int(r['id'])}" for r in entity_rows}
    for r in rel_rows:
        s, d = f"e{int(r['src_entity_id'])}", f"e{int(r['dst_entity_id'])}"
        if s in eset and d in eset and s != d:
            edges.append({"source": s, "target": d, "kind": "relates", "label": r["label"]})
    for m in mention_rows:
        e, c = f"e{int(m['entity_id'])}", f"c{int(m['chunk_id'])}"
        if e in eset and c in chunk_keys:
            edges.append({"source": e, "target": c, "kind": "mentions"})


@router.get("/knowledge/stats")
async def stats():
    async with pool().acquire() as conn:
        total_files = await conn.fetchval("SELECT COUNT(*) FROM uploaded_files")
        storage_bytes = await conn.fetchval("SELECT COALESCE(SUM(file_size_bytes), 0) FROM uploaded_files")

        models_used = []
        registry = await conn.fetch(
            "SELECT model_name, table_name FROM embedding_model_registry ORDER BY created_at"
        )
        total_chunks = 0
        for row in registry:
            chunk_count = await conn.fetchval(f"SELECT COUNT(*) FROM {row['table_name']}")
            file_count = await conn.fetchval(
                f"SELECT COUNT(DISTINCT source_file_id) FROM {row['table_name']}"
            )
            total_chunks += int(chunk_count or 0)
            models_used.append(
                {
                    "model": row["model_name"],
                    "chunk_count": int(chunk_count or 0),
                    "file_count": int(file_count or 0),
                }
            )

    return {
        "total_files": int(total_files or 0),
        "total_chunks": total_chunks,
        "models_used": models_used,
        "total_storage_mb": round(float(storage_bytes or 0) / (1024 * 1024), 2),
    }


@router.get("/knowledge/files")
async def list_files():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, filename, status, total_chunks, embedding_model,
                    file_size_bytes, mime_type, error_message, created_at,
                    entity_status, entity_error, entity_count, relation_count
            FROM uploaded_files
            ORDER BY created_at DESC
            """
        )
    return [
        {
            "id": r["id"],
            "filename": r["filename"],
            "status": r["status"],
            "total_chunks": r["total_chunks"] or 0,
            "embedding_model": r["embedding_model"],
            "file_size_bytes": r["file_size_bytes"],
            "mime_type": r["mime_type"],
            "error_message": r["error_message"],
            "created_at": r["created_at"].isoformat(),
            "entity_status": r["entity_status"] or "skipped",
            "entity_error": r["entity_error"],
            "entity_count": r["entity_count"] or 0,
            "relation_count": r["relation_count"] or 0,
        }
        for r in rows
    ]


@router.get("/knowledge/graph")
async def graph(
    model: str | None = Query(default=None, description="Embedding model to visualize"),
    limit: int = Query(default=150, ge=10, le=400),
    neighbors: int = Query(default=3, ge=0, le=5, description="Top-k semantic links per chunk"),
    min_similarity: float = Query(default=0.55, ge=0.0, le=1.0),
    file_id: int | None = Query(default=None, description="Restrict to one file"),
    strategy: str = Query(
        default="balanced",
        description="Sampling when chunks exceed limit: balanced (stratified per file) or recent",
    ),
    layer: str = Query(
        default="chunks",
        description="Graph layer: chunks (files+chunks), entities (entities+relations), or both",
    ),
):
    """2D knowledge-graph data.

    Chunk layer: file nodes -> chunk nodes (contains) + semantic chunk links.
    Entity layer: entity nodes + labeled relation links (+ mention links to
    sampled chunks in 'both' mode). Entity tables are model-independent.
    """
    if strategy not in ("balanced", "recent"):
        raise HTTPException(status_code=422, detail="strategy must be 'balanced' or 'recent'.")
    if layer not in ("chunks", "entities", "both"):
        raise HTTPException(status_code=422, detail="layer must be 'chunks', 'entities' or 'both'.")

    cache_key = (model, limit, neighbors, round(min_similarity, 4), file_id, strategy, layer)
    now = time.monotonic()
    hit = _graph_cache.get(cache_key)
    if hit is not None and now - hit[0] < _GRAPH_CACHE_TTL:
        return hit[1]

    async with pool().acquire() as conn:
        registry = await conn.fetch(
            "SELECT model_name, table_name FROM embedding_model_registry ORDER BY created_at"
        )
        want_chunks = layer in ("chunks", "both")
        if not registry:
            if not want_chunks:
                # Entity-only layer works without any embedding model.
                entity_rows, rel_rows, total_entities = await _fetch_entity_layer(conn, file_id)
                nodes: list[dict] = []
                edges: list[dict] = []
                _append_entity_layer(nodes, edges, entity_rows, rel_rows, [], set())
                payload = {
                    "model": None,
                    "models_available": [],
                    "nodes": nodes,
                    "edges": edges,
                    "total_chunks": 0,
                    "returned_chunks": 0,
                    "truncated": False,
                    "strategy": strategy,
                    "layer": layer,
                    "total_entities": total_entities,
                    "returned_entities": len(entity_rows),
                }
                _graph_cache[cache_key] = (now, payload)
                return payload
            return {"model": None, "nodes": [], "edges": [], "total_chunks": 0, "truncated": False}

        # Resolve which model table to visualize.
        target = None
        if model:
            for row in registry:
                if row["model_name"] == model:
                    target = row
                    break
            if target is None:
                raise HTTPException(status_code=404, detail=f"No chunk table for model {model!r}.")
        else:
            # Default to the model holding the most chunks.
            best_count = -1
            for row in registry:
                try:
                    n = await conn.fetchval(f"SELECT COUNT(*) FROM {row['table_name']}")
                except Exception:
                    n = 0
                if int(n or 0) > best_count:
                    best_count = int(n or 0)
                    target = row

        assert target is not None
        table = target["table_name"]  # from our own registry — never user input
        model_name = target["model_name"]

        # Scope-aware total (respects the file filter).
        if file_id is not None:
            total_chunks = await conn.fetchval(
                f"SELECT COUNT(*) FROM {table} WHERE source_file_id = $1", file_id
            )
            num_files = 1
        else:
            total_chunks = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
            num_files = await conn.fetchval(f"SELECT COUNT(DISTINCT source_file_id) FROM {table}")

        # --- Sampling: ONE query (ROW_NUMBER stratifies per file server-side) ---
        per_file = max(1, math.ceil(limit / max(1, int(num_files or 1))))
        base = f"""
                SELECT c.id, c.content, c.source_file_id, c.heading_hierarchy,
                       c.token_count, f.filename
                FROM {table} c
                JOIN uploaded_files f ON f.id = c.source_file_id
                """
        if not want_chunks:
            rows = []
        elif strategy == "recent" or file_id is not None:
            filt = "WHERE c.source_file_id = $1\n" if file_id is not None else ""
            args: list = [file_id, limit] if file_id is not None else [limit]
            rows = await conn.fetch(
                base + filt + "ORDER BY c.id DESC\nLIMIT $%d" % len(args),
                *args,
            )
            rows = rows[::-1]  # chronological for stable layout
        else:
            rows = await conn.fetch(
                f"""
                SELECT id, content, source_file_id, heading_hierarchy, token_count, filename
                FROM (
                    SELECT c.id, c.content, c.source_file_id, c.heading_hierarchy,
                           c.token_count, f.filename,
                           ROW_NUMBER() OVER (
                               PARTITION BY c.source_file_id ORDER BY c.id DESC
                           ) AS rn
                    FROM {table} c
                    JOIN uploaded_files f ON f.id = c.source_file_id
                ) s
                WHERE rn <= $1
                ORDER BY id DESC
                LIMIT $2
                """,
                per_file,
                limit,
            )
            rows = rows[::-1]

        # --- Semantic edges: computed in SQL (C vector ops, no embedding transfer) ---
        similar_pairs: list[tuple[int, int, float]] = []
        if neighbors > 0 and len(rows) > 1:
            ids = [int(r["id"]) for r in rows]
            nbr_rows = await conn.fetch(
                f"""
                WITH sample AS (
                    SELECT c.id, c.embedding FROM {table} c WHERE c.id = ANY($1::int[])
                ),
                nbrs AS (
                    SELECT a.id AS src, b.id AS dst,
                           1 - (a.embedding <=> b.embedding) AS sim,
                           ROW_NUMBER() OVER (
                               PARTITION BY a.id ORDER BY b.embedding <=> a.embedding
                           ) AS rn
                    FROM sample a
                    JOIN sample b ON b.id <> a.id
                )
                SELECT src, dst, sim FROM nbrs WHERE rn <= $2 AND sim >= $3
                """,
                ids,
                neighbors + 1,  # +1: top-k each way, deduped to undirected below
                FETCH_SIM_FLOOR,
            )
            for r in nbr_rows:
                a, b = int(r["src"]), int(r["dst"])
                similar_pairs.append((a, b, float(r["sim"])))

        # --- Entity layer (model-independent tables) ---
        entity_rows: list = []
        rel_rows: list = []
        mention_rows: list = []
        total_entities = 0
        if layer in ("entities", "both"):
            entity_rows, rel_rows, total_entities = await _fetch_entity_layer(conn, file_id)
            if layer == "both" and rows and entity_rows:
                mention_rows = await conn.fetch(
                    "SELECT entity_id, chunk_id FROM entity_mentions "
                    "WHERE chunk_id = ANY($1::int[]) AND entity_id = ANY($2::int[]) "
                    "LIMIT $3",
                    [int(r["id"]) for r in rows],
                    [int(r["id"]) for r in entity_rows],
                    MENTION_EDGE_LIMIT,
                )

    # --- Build nodes ---
    nodes: list[dict] = []
    edges: list[dict] = []
    files_seen: dict[int, str] = {}
    for r in rows:
        fid = int(r["source_file_id"])
        if fid not in files_seen:
            files_seen[fid] = r["filename"] or f"File {fid}"

    for fid, fname in files_seen.items():
        chunk_count = sum(1 for r in rows if int(r["source_file_id"]) == fid)
        nodes.append(
            {
                "id": f"f{fid}",
                "type": "file",
                "label": fname,
                "file_id": fid,
                "chunk_count": chunk_count,
            }
        )

    # Parse embeddings once for cosine similarity.
    # (Removed: similarities now come from the SQL query above —
    #  no multi-MB embedding transfer, no O(N^2*D) Python loop.)
    chunk_keys: set[str] = {f"c{int(r['id'])}" for r in rows}

    for r in rows:
        cid = int(r["id"])
        content = r["content"] or ""
        headings = list(r["heading_hierarchy"]) if r["heading_hierarchy"] else []
        label = headings[0] if headings else f"Chunk {cid}"
        nodes.append(
            {
                "id": f"c{cid}",
                "type": "chunk",
                "label": label[:80],
                "file_id": int(r["source_file_id"]),
                "filename": r["filename"],
                "preview": content[:280],
                "headings": headings,
                "token_count": r["token_count"],
            }
        )
        edges.append({"source": f"f{int(r['source_file_id'])}", "target": f"c{cid}", "kind": "contains"})

    # --- Semantic edges: dedupe directed SQL pairs to undirected links ---
    best: dict[tuple[int, int], float] = {}
    for a, b, sim in similar_pairs:
        if sim < min_similarity:
            continue
        key = (a, b) if a < b else (b, a)
        if sim > best.get(key, -1.0):
            best[key] = sim
    for (a, b), sim in best.items():
        sa, sb = f"c{a}", f"c{b}"
        if sa in chunk_keys and sb in chunk_keys:
            edges.append({"source": sa, "target": sb, "kind": "similar", "weight": round(sim, 4)})

    if layer in ("entities", "both"):
        _append_entity_layer(nodes, edges, entity_rows, rel_rows, mention_rows, chunk_keys)

    log.info(
        "knowledge.graph",
        model=model_name,
        nodes=len(nodes),
        edges=len(edges),
        truncated=len(rows) >= limit,
        strategy=strategy,
        layer=layer,
    )
    payload = {
        "model": model_name,
        "models_available": [r["model_name"] for r in registry],
        "nodes": nodes,
        "edges": edges,
        "total_chunks": int(total_chunks or 0),
        "returned_chunks": len(rows),
        "truncated": len(rows) >= limit,
        "strategy": strategy,
        "layer": layer,
        "total_entities": total_entities,
        "returned_entities": len(entity_rows),
    }
    if len(_graph_cache) >= _GRAPH_CACHE_MAX:
        oldest = min(_graph_cache.items(), key=lambda kv: kv[1][0])[0]
        del _graph_cache[oldest]
    _graph_cache[cache_key] = (now, payload)
    return payload


@router.delete("/knowledge/files/{file_id}")
async def delete_file(file_id: int):
    async with pool().acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM uploaded_files WHERE id = $1", file_id)
        if not exists:
            raise HTTPException(status_code=404, detail="File not found.")

        removed = 0
        tables = await conn.fetch("SELECT table_name FROM embedding_model_registry")
        for row in tables:
            # Table names come from our own registry (validated at creation time)
            n = await conn.fetchval(
                f"SELECT COUNT(*) FROM {row['table_name']} WHERE source_file_id = $1", file_id
            )
            removed += int(n or 0)

        await conn.execute("DELETE FROM uploaded_files WHERE id = $1", file_id)

    invalidate_graph_cache()
    log.info("knowledge.file_deleted", file_id=file_id, chunks_removed=removed)
    return {"status": "deleted", "chunks_removed": removed}


@router.get("/knowledge/files/{file_id}")
async def get_file_detail(file_id: int):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, filename, status, raw_markdown, total_chunks, embedding_model,
                    file_size_bytes, error_message, created_at,
                    entity_status, entity_error, entity_count, relation_count
            FROM uploaded_files WHERE id = $1
            """,
            file_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="File not found.")
    return {
        "id": row["id"],
        "filename": row["filename"],
        "status": row["status"],
        "raw_markdown": row["raw_markdown"],
        "total_chunks": row["total_chunks"] or 0,
        "embedding_model": row["embedding_model"],
        "file_size_bytes": row["file_size_bytes"],
        "error_message": row["error_message"],
        "created_at": row["created_at"].isoformat(),
        "entity_status": row["entity_status"] or "skipped",
        "entity_error": row["entity_error"],
        "entity_count": row["entity_count"] or 0,
        "relation_count": row["relation_count"] or 0,
    }


@router.post("/knowledge/files/{file_id}/extract-entities")
async def trigger_extraction(file_id: int, config: ChatConfig):
    """Manually (re)run entity extraction for an ingested file (durable job)."""
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, embedding_model FROM uploaded_files WHERE id = $1",
            file_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="File not found.")
        if row["status"] != "completed":
            raise HTTPException(status_code=409, detail="File ingestion has not completed yet.")
        job = await conn.fetchrow("SELECT status FROM extraction_jobs WHERE file_id = $1", file_id)
        if (job and job["status"] in ("queued", "processing")) or await is_extracting(file_id):
            return {"status": "already_running", "file_id": file_id}
        reg = await conn.fetchrow(
            "SELECT table_name FROM embedding_model_registry WHERE model_name = $1",
            row["embedding_model"],
        )
        if not reg:
            raise HTTPException(status_code=409, detail="No chunk table for this file's model.")
        table = reg["table_name"]  # from our own registry — never user input

    queued = await enqueue_extraction(file_id, config, table)
    if not queued:
        return {"status": "already_running", "file_id": file_id}
    log.info("entities.queued", file_id=file_id, model=config.llm_model)
    return {"status": "started", "file_id": file_id}


@router.get("/knowledge/entities")
async def list_entities(
    file_id: int | None = Query(default=None),
    q: str | None = Query(default=None, description="Substring match on entity name"),
    type: str | None = Query(default=None, description="Filter by entity type"),
    limit: int = Query(default=100, ge=1, le=500),
):
    """Canonical entities with mention/file counts (phase 3 foundation)."""
    conds: list[str] = []
    args: list = []
    if file_id is not None:
        args.append(file_id)
        conds.append(f"EXISTS (SELECT 1 FROM entity_mentions m WHERE m.entity_id = e.id AND m.source_file_id = ${len(args)})")
    if q:
        args.append(f"%{q.strip().lower()}%")
        conds.append(f"e.normalized LIKE ${len(args)}")
    if type:
        args.append(type.strip().lower())
        conds.append(f"e.type = ${len(args)}")
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT e.id, e.name, e.type, e.mention_count,
                   COUNT(DISTINCT m.source_file_id) AS file_count
            FROM entities e
            LEFT JOIN entity_mentions m ON m.entity_id = e.id
            {where}
            GROUP BY e.id
            ORDER BY e.mention_count DESC
            LIMIT ${len(args) + 1}
            """,
            *args,
            limit,
        )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "type": r["type"],
            "mention_count": r["mention_count"] or 0,
            "file_count": r["file_count"] or 0,
        }
        for r in rows
    ]
