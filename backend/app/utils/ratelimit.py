"""Lightweight in-memory sliding-window rate limiter.

Per-IP, per-process — good enough to blunt accidental loops and casual abuse
on a single-node deployment. Not a substitute for edge-level limiting when
scaling horizontally. Configure with `RATE_LIMIT_PER_MINUTE` (0 disables).
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from .logger import get_logger

log = get_logger(__name__)


class SlidingWindowLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self.limit = limit_per_minute
        self.window_seconds = 60.0
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._hits[key]
        cutoff = now - self.window_seconds
        while q and q[0] <= cutoff:
            q.popleft()
        return q

    def allow(self, key: str) -> bool:
        """Record a hit for `key` and return False when over the limit."""
        if self.limit <= 0:
            return True
        now = time.monotonic()
        q = self._prune(key, now)
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


def client_ip(request) -> str:
    """Best-effort client identity (respects the nginx X-Forwarded-For hop)."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
