"""File tracking + SHA-256 deduplication."""
from __future__ import annotations

import hashlib

from ..database import pool


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def find_duplicate(file_hash: str) -> int | None:
    async with pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT id FROM uploaded_files WHERE file_hash = $1", file_hash
        )


async def insert_file_record(
    filename: str,
    file_hash: str,
    size_bytes: int,
    mime_type: str | None,
    embedding_model: str,
) -> int:
    async with pool().acquire() as conn:
        return await conn.fetchval(
            """
            INSERT INTO uploaded_files
                (filename, file_hash, file_size_bytes, mime_type, embedding_model, status)
            VALUES ($1, $2, $3, $4, $5, 'processing')
            RETURNING id
            """,
            filename,
            file_hash,
            size_bytes,
            mime_type,
            embedding_model,
        )


async def update_file_status(
    file_id: int,
    status: str,
    raw_markdown: str | None = None,
    total_chunks: int | None = None,
    error_message: str | None = None,
) -> None:
    async with pool().acquire() as conn:
        await conn.execute(
            """
            UPDATE uploaded_files
            SET status = $2,
                raw_markdown = COALESCE($3, raw_markdown),
                total_chunks = COALESCE($4, total_chunks),
                error_message = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            """,
            file_id,
            status,
            raw_markdown,
            total_chunks,
            error_message,
        )
