"""Tests for the optional bearer-token auth and the rate limiter."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.config import get_settings
from app.utils.auth import require_api_token


@pytest.fixture()
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _client(token_env: str) -> TestClient:
    if token_env:
        os.environ["API_AUTH_TOKEN"] = token_env
    else:
        os.environ.pop("API_AUTH_TOKEN", None)

    test_app = FastAPI()

    @test_app.get("/protected", dependencies=[Depends(require_api_token)])
    async def protected():
        return {"ok": True}

    return TestClient(test_app)


def test_auth_disabled_when_no_token(_clear_settings_cache):
    client = _client("")
    assert client.get("/protected").status_code == 200


def test_missing_token_rejected(_clear_settings_cache):
    client = _client("s3cret")
    assert client.get("/protected").status_code == 401


def test_wrong_token_rejected(_clear_settings_cache):
    client = _client("s3cret")
    assert (
        client.get("/protected", headers={"Authorization": "Bearer wrong"}).status_code == 401
    )


def test_non_bearer_scheme_rejected(_clear_settings_cache):
    client = _client("s3cret")
    assert (
        client.get("/protected", headers={"Authorization": "Basic s3cret"}).status_code == 401
    )


def test_correct_token_accepted(_clear_settings_cache):
    client = _client("s3cret")
    resp = client.get("/protected", headers={"Authorization": "Bearer s3cret"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# ---------------------------------------------------------------- limiter ----


def test_limiter_allows_within_limit():
    from app.utils.ratelimit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit_per_minute=3)
    assert all(limiter.allow("1.2.3.4") for _ in range(3))


def test_limiter_blocks_over_limit():
    from app.utils.ratelimit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit_per_minute=3)
    for _ in range(3):
        assert limiter.allow("1.2.3.4")
    assert not limiter.allow("1.2.3.4")


def test_limiter_keys_are_independent():
    from app.utils.ratelimit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit_per_minute=1)
    assert limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")


def test_limiter_disabled_at_zero():
    from app.utils.ratelimit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit_per_minute=0)
    assert all(limiter.allow("x") for _ in range(100))
