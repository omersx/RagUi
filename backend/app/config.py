"""Environment-driven settings (Pydantic BaseSettings).

Dev default DB host is `localhost`; in production compose the DATABASE_URL env
var points at the `db` service instead.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+asyncpg://ragui:ragui_dev@localhost:5432/ragui"
    ollama_base_url: str = "http://localhost:11434"
    max_upload_size_mb: int = 50
    allowed_origins: str = "http://localhost:3000"
    log_level: str = "INFO"
    # Shared bearer token protecting every route except /api/health (empty = off)
    api_auth_token: str = ""
    # Per-IP request cap for /api routes (0 disables the limiter)
    rate_limit_per_minute: int = 120

    @property
    def asyncpg_dsn(self) -> str:
        """asyncpg wants a plain postgresql:// DSN (no +driver suffix)."""
        return self.database_url.replace("postgresql+asyncpg://", "postgresql://")

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
