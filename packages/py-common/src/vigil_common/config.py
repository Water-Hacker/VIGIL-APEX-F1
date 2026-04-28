"""Settings (Pydantic-Settings) — env-var-driven runtime configuration.

Mirrors the `.env.example` keys consumed by the TypeScript workers so the
two languages share one source of truth at the deployment surface.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Subset of the workspace `.env` exposed to the Python workers."""

    model_config = SettingsConfigDict(
        env_file=None,                   # Compose feeds env directly
        env_prefix="",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Runtime ----
    node_env: Literal["development", "test", "production"] = "production"
    log_level: Literal["trace", "debug", "info", "warn", "error", "fatal"] = "info"
    tz: str = "Africa/Douala"
    vigil_phase: str = "1"

    # ---- Vault ----
    vault_addr: str = "http://vigil-vault:8200"
    vault_token_file: Path = Path("/run/secrets/vault_token_worker")
    vault_kv_mount: str = "secret"

    # ---- Postgres ----
    postgres_host: str = "vigil-postgres"
    postgres_port: int = 5432
    postgres_db: str = "vigil"
    postgres_user: str = "vigil"
    postgres_password_file: Path = Path("/run/secrets/pg_password")
    postgres_pool_min: int = 1
    postgres_pool_max: int = 10
    postgres_statement_timeout_ms: int = 30_000
    postgres_lock_timeout_ms: int = 5_000

    # ---- Redis Streams ----
    redis_host: str = "vigil-redis"
    redis_port: int = 6379
    redis_password_file: Path = Path("/run/secrets/redis_password")
    redis_db: int = 0
    redis_stream_block_ms: int = 5_000
    redis_consumer_idle_reclaim_ms: int = 300_000

    # ---- IPFS ----
    ipfs_api_url: str = "http://vigil-ipfs:5001"

    # ---- Anti-hallucination targets (mirror llm guards) ----
    ece_warning_threshold: float = 0.05
    ece_alarm_threshold: float = 0.10

    # ---- Observability ----
    otel_exporter_otlp_endpoint: str | None = None
    otel_service_name: str = "vigil-py-worker"
    prometheus_port: int = 9100

    # ---- Worker self-identity (overridden per-app via env) ----
    worker_name: str = Field(default="vigil-py-worker")

    # ---- Sentinel Hub (worker-satellite) ----
    sentinelhub_client_id_file: Path = Field(
        default=Path("/run/secrets/sentinelhub_client_id"),
    )
    sentinelhub_client_secret_file: Path = Field(
        default=Path("/run/secrets/sentinelhub_client_secret"),
    )

    # ---- STAC catalog (Microsoft Planetary Computer is free + tokenless) ----
    stac_catalog_url: str = "https://planetarycomputer.microsoft.com/api/stac/v1"

    # ---- Tesseract / OCR (worker-image-forensics) ----
    tesseract_data_path: Path = Path("/usr/share/tesseract-ocr/5/tessdata")
