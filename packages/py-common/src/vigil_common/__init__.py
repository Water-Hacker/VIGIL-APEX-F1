"""Shared helpers for VIGIL APEX Python workers.

Mirrors `@vigil/observability`, `@vigil/queue`, `@vigil/security`, and
`@vigil/db-postgres` from the TypeScript side, kept intentionally lean so the
Python workers never duplicate cross-cutting concerns.
"""

from .config import Settings
from .errors import VigilError, asVigilError
from .logging import bind_correlation, get_logger, init_logging
from .metrics import errors_total, events_consumed, events_emitted, processing_duration
from .redis_consumer import Envelope, HandlerOutcome, RedisStreamWorker
from .pg import PgPool
from .secrets import read_secret_file
from .shutdown import install_shutdown
from .vault import VaultClient

__all__ = [
    "Settings",
    "VigilError",
    "asVigilError",
    "bind_correlation",
    "get_logger",
    "init_logging",
    "events_consumed",
    "events_emitted",
    "errors_total",
    "processing_duration",
    "Envelope",
    "HandlerOutcome",
    "RedisStreamWorker",
    "PgPool",
    "read_secret_file",
    "install_shutdown",
    "VaultClient",
]
