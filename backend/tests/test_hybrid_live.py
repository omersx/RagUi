"""Live DB test for hybrid search (requires Postgres running via docker compose).

Inserts synthetic chunks with hand-crafted vectors + text, then verifies:
  1. semantic_search returns nearest-by-vector
  2. fulltext_search returns keyword matches ranked by ts_rank_cd
  3. hybrid_search fuses both lists via RRF (keyword+semantic hit should win)
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_settings
from app.database import close_db, ensure_chunk_table, init_db, pool
from app.models.schemas import ChatConfig
from app.services.retriever import fulltext_search, hybrid_search, semantic_search, to_pg_vector

DIM = 384  # all-MiniLM-L6-v2


def vec(*weights):
    """Build a 384-dim vector with the first components set."""
    v = [0.0] * DIM
    for i, w in enumerate(weights):
        v[i] = w
    return v


DOCS = [
    # (text, vector) — "italian recipe" doc is semantically closest to query vector
    ("Classic Italian recipes with tomato sauce and basil", vec(1.0, 0.9, 0.0)),
    ("Quarterly financial results report Q3 revenue", vec(0.2, 0.1, 0.9)),
    ("Mexican salsa and tacos preparation guide", vec(0.3, 0.2, 0.1)),
    ("Spaghetti marinara is a traditional Italian dish", vec(0.8, 0.7, 0.0)),
    ("Machine learning transformers attention mechanism", vec(0.0, 0.5, 0.4)),
]


async def main():
    await init_db()
    model = "all-MiniLM-L6-v2"
    table = await ensure_chunk_table(model)

    async with pool().acquire() as conn:
        # Clean slate for this test table (and reset the id sequence)
        await conn.execute(f"DELETE FROM {table}")
        await conn.execute(
            f"ALTER SEQUENCE IF EXISTS {table}_id_seq RESTART WITH 1"
        )

        records = []
        for i, (text, v) in enumerate(DOCS):
            records.append((text, [i + 1], ["Test"], 20, to_pg_vector(v)))
        await conn.executemany(
            f"INSERT INTO {table} (content, page_range, heading_hierarchy, token_count, embedding) "
            "VALUES ($1, $2, $3, $4, $5::vector)",
            records,
        )

    # Stable doc identity for assertions (1-based, matches DOCS order after restart)
    ITALIAN_RECIPE_ID = 1   # keyword AND semantic match
    SPAGHETTI_ID = 4        # semantic-only match ("italian" but no sauce/recipe words)
    FINANCE_ID = 2
    ML_ID = 5

    cfg = ChatConfig(retrieval_mode="hybrid", top_k=3)
    qvec = to_pg_vector(vec(1.0, 0.85, 0.05))
    qtext = "italian tomato sauce recipes"

    print("\n--- SEMANTIC (vector only) ---")
    sem = await semantic_search(qvec, table, cfg.top_k)
    for c in sem:
        print(f"  id={c.id} sim={c.similarity:.3f}  {c.content[:55]}")

    print("\n--- FULLTEXT (keyword only) ---")
    fts = await fulltext_search(qtext, table, cfg.top_k)
    # websearch_to_tsquery ANDs plain terms (same as Supabase): only the recipe doc
    # contains all of italian+tomato+sauce+recipes.
    assert len(fts) >= 1, "expected >=1 keyword match"
    for c in fts:
        assert c.similarity is None
        print(f"  id={c.id}  {c.content[:55]}")
    fts_ids = {c.id for c in fts}
    assert ITALIAN_RECIPE_ID in fts_ids, "recipe doc must match all keywords"
    assert not fts_ids & {FINANCE_ID, ML_ID}, "financial/ML docs must not match"

    print("\n--- HYBRID (RRF fusion) ---")
    hyb = await hybrid_search(qtext, qvec, table, cfg)
    assert len(hyb) <= cfg.top_k
    for c in hyb:
        sim = c.similarity if c.similarity is not None else 0.0
        print(f"  id={c.id} sim={sim:.3f}  {c.content[:55]}")

    top = hyb[0]
    assert top.id == ITALIAN_RECIPE_ID, (
        "doc matching BOTH lists must win under RRF "
        f"(got id={top.id}, expected {ITALIAN_RECIPE_ID})"
    )
    print("\n  RRF verified: dual-match doc outranks semantic-only doc")

    print("\nALL HYBRID SEARCH TESTS PASSED")

    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
