"""POST /api/chat — RAG pipeline with Server-Sent Events streaming."""
from __future__ import annotations

import json
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..database import pool
from ..models.schemas import ChatConfig, ChatRequest
from ..services.generator import generate_once, generate_stream
from ..services.retriever import retrieve
from ..utils.logger import get_logger

router = APIRouter()
log = get_logger(__name__)

# Cap on how much conversation history is replayed to the LLM each turn.
# Long sessions would otherwise blow past context windows and inflate costs.
MAX_HISTORY_MESSAGES = 24

SYSTEM_TEMPLATE = """You are a helpful assistant. Answer the user's question based on the following retrieved context.
If the context doesn't contain relevant information, say so honestly.
Always cite which section the information comes from (e.g. [report.pdf, pages 3-4]).

CONTEXT:
{context}"""


def _trimmed_history(messages: list[ChatMessage]) -> list[ChatMessage]:
    """Keep the latest MAX_HISTORY_MESSAGES, always including the final user turn."""
    if len(messages) <= MAX_HISTORY_MESSAGES:
        return messages
    return [*messages[-(MAX_HISTORY_MESSAGES) : -1], messages[-1]]


def _sse(event_type: str, payload: dict | None = None) -> str:
    body = {"type": event_type}
    if payload:
        body.update(payload)
    return f"data: {json.dumps(body)}\n\n"


def _parse_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


async def _get_or_create_session(session_id: str | None, config: ChatConfig):
    sid = _parse_uuid(session_id)
    async with pool().acquire() as conn:
        if sid is not None:
            row = await conn.fetchrow("SELECT * FROM chat_sessions WHERE id = $1", sid)
            if row is not None:
                return row

        new_id = await conn.fetchval(
            """
            INSERT INTO chat_sessions (embedding_model, llm_model)
            VALUES ($1, $2)
            RETURNING *
            """,
            config.embedding_model,
            config.llm_model,
        )
        return await conn.fetchrow("SELECT * FROM chat_sessions WHERE id = $1", new_id)


async def _save_message(session_id: uuid.UUID, role: str, content: str, chunk_ids=None):
    async with pool().acquire() as conn:
        await conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, retrieved_chunk_ids) VALUES ($1, $2, $3, $4)",
            session_id,
            role,
            content,
            list(chunk_ids or []),
        )


async def _message_count(session_id: uuid.UUID) -> int:
    async with pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM chat_messages WHERE session_id = $1", session_id
        )


async def _auto_title(session_id: uuid.UUID, question: str, answer: str, config: ChatConfig) -> str:
    prompt = (
        "Summarize this conversation exchange in a title of at most 50 characters. "
        "Reply with the title only, no quotes or punctuation at the end.\n\n"
        f"User: {question[:500]}\nAssistant: {answer[:500]}"
    )
    title = (await generate_once(prompt, config)).strip().strip('"').strip()
    if title:
        title = title[:50]
        async with pool().acquire() as conn:
            await conn.execute(
                "UPDATE chat_sessions SET title = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                session_id,
                title,
            )
    return title


async def _chat_pipeline(req: ChatRequest) -> AsyncGenerator[str, None]:
    try:
        config = req.config
        user_message = req.messages[-1].content.strip()
        if not user_message:
            yield _sse("error", {"message": "Empty message."})
            return

        # 1. Session (locked embedding model wins for retrieval)
        session = await _get_or_create_session(req.session_id, config)
        sid = session["id"]
        retrieval_config = config.model_copy(update={"embedding_model": session["embedding_model"]})
        yield _sse("session", {"session_id": str(sid), "title": session["title"]})

        # 2. Persist user message
        await _save_message(sid, "user", user_message)

        # 3-4. Retrieve relevant chunks (sources arrive before any token)
        chunks = await retrieve(user_message, retrieval_config)
        yield _sse(
            "sources",
            {"chunks": [c.model_dump(exclude_none=True) for c in chunks]},
        )

        # 5. Build augmented prompt
        context_blocks = []
        for i, c in enumerate(chunks, start=1):
            headings = ", ".join(c.heading_hierarchy) if c.heading_hierarchy else ""
            pages = f"pages {c.page_range[0]}-{c.page_range[-1]}" if c.page_range else "page unknown"
            label = f"[Source {i}: {headings} — {pages}]" if headings else f"[Source {i}: {pages}]"
            context_blocks.append(f"{label}\n{c.content}")
        context = "\n\n---\n\n".join(context_blocks) or "(No indexed documents matched this question.)"
        system_prompt = SYSTEM_TEMPLATE.format(context=context)

        # 6. Stream tokens (history is capped to protect context windows)
        full_response_parts: list[str] = []
        async for token in generate_stream(system_prompt, _trimmed_history(req.messages), config):
            full_response_parts.append(token)
            yield _sse("token", {"content": token})
        full_response = "".join(full_response_parts)

        # 7. Persist assistant message + auto-title on first exchange
        await _save_message(sid, "assistant", full_response, [c.id for c in chunks])

        count = await _message_count(sid)
        if count <= 2:
            title = await _auto_title(sid, user_message, full_response, config)
            if title:
                yield _sse("title", {"title": title})

        yield _sse("done", {"full_response": full_response})
    except HTTPException as exc:
        # Deliberate, user-facing errors (bad key, provider down) keep their message.
        log.warning("chat.pipeline_error", detail=str(exc.detail))
        yield _sse("error", {"message": str(exc.detail)})
        yield _sse("done", {"full_response": ""})
    except Exception as exc:
        # Unexpected failures: log everything server-side, stay vague client-side.
        log.error("chat.pipeline_error", error=str(exc), exc_info=True)
        yield _sse("error", {"message": "Chat failed — check server logs."})
        yield _sse("done", {"full_response": ""})


@router.post("/chat")
async def chat(req: ChatRequest):
    return StreamingResponse(
        _chat_pipeline(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Critical for SSE through reverse proxies
            "X-Accel-Buffering": "no",
        },
    )
