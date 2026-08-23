"""Chat session history CRUD."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from ..database import pool

router = APIRouter()


def _parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid session id format.")


@router.get("/sessions")
async def list_sessions():
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.title, s.embedding_model, s.llm_model, s.created_at, s.updated_at,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
            FROM chat_sessions s
            ORDER BY s.updated_at DESC
            """
        )
    return [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "embedding_model": r["embedding_model"],
            "llm_model": r["llm_model"],
            "message_count": int(r["message_count"] or 0),
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    sid = _parse_uuid(session_id)
    async with pool().acquire() as conn:
        session_exists = await conn.fetchval("SELECT 1 FROM chat_sessions WHERE id = $1", sid)
        if not session_exists:
            raise HTTPException(status_code=404, detail="Session not found.")
        rows = await conn.fetch(
            """
            SELECT id, role, content, retrieved_chunk_ids, created_at
            FROM chat_messages
            WHERE session_id = $1 AND role != 'system'
            ORDER BY id ASC
            """,
            sid,
        )
    return [
        {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "retrieved_chunk_ids": list(r["retrieved_chunk_ids"] or []),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    sid = _parse_uuid(session_id)
    async with pool().acquire() as conn:
        deleted = await conn.fetchval(
            "DELETE FROM chat_sessions WHERE id = $1 RETURNING id", sid
        )
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"status": "deleted"}
