"""Optional shared-token authentication.

When `API_AUTH_TOKEN` is set, every request to protected routes must carry
`Authorization: Bearer <token>`. `/api/health` stays open so container
healthchecks and load-balancer probes keep working. When the variable is
empty (default) the API behaves exactly as before — zero-config for local dev.
"""
from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status

from ..config import get_settings
from .logger import get_logger

log = get_logger(__name__)


def token_configured() -> bool:
    return bool(get_settings().api_auth_token)


async def require_api_token(request: Request) -> None:
    expected = get_settings().api_auth_token
    if not expected:
        return  # auth disabled (development / trusted network)

    header = request.headers.get("Authorization", "")
    scheme, _, credential = header.partition(" ")
    if scheme.lower() != "bearer" or not credential:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not secrets.compare_digest(credential.encode(), expected.encode()):
        log.warning("auth.rejected", path=request.url.path)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
