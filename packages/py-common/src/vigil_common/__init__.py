"""Shared helpers for VIGIL APEX Python workers.

Mirrors `@vigil/observability`, `@vigil/queue`, `@vigil/security`, and
`@vigil/db-postgres` from the TypeScript side, kept intentionally lean so the
Python workers never duplicate cross-cutting concerns.
"""

from .config import Settings
from .errors import VigilError, asVigilError
from .logging import bind_correlation, get_logger, init_logging
from .metrics import errors_total, events_consumed, events_emitted, processing_duration
from .pg import PgPool
from .redis_consumer import Envelope, HandlerOutcome, RedisStreamWorker
from .secrets import read_secret_file
from .shutdown import install_shutdown
from .vault import VaultClient

__all__ = [
    "Envelope",
    "HandlerOutcome",
    "PgPool",
    "RedisStreamWorker",
    "Settings",
    "VaultClient",
    "VigilError",
    "asVigilError",
    "bind_correlation",
    "errors_total",
    "events_consumed",
    "events_emitted",
    "get_logger",
    "init_logging",
    "install_shutdown",
    "processing_duration",
    "read_secret_file",
]
