"""Knowledge-base stats, file listing, and deletion."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..database import pool
from ..utils.logger import get_logger
from ..utils.model_registry import get_chunk_table_name

router = APIRouter()
log = get_logger(__name__)


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
                   file_size_bytes, mime_type, error_message, created_at
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
        }
        for r in rows
    ]


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

    log.info("knowledge.file_deleted", file_id=file_id, chunks_removed=removed)
    return {"status": "deleted", "chunks_removed": removed}


@router.get("/knowledge/files/{file_id}")
async def get_file_detail(file_id: int):
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, filename, status, raw_markdown, total_chunks, embedding_model,
                   file_size_bytes, error_message, created_at
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
    }
