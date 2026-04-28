"""Structured logging via structlog.

Every log line includes `service`, `phase`, `correlation_id` (if set), and
the standard fields (ts ISO8601, level, hostname, pid). Mirrors the contract
in `@vigil/observability/logger.ts`.
"""

from __future__ import annotations

import contextvars
import logging
import os
import socket
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger

_correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_vigil_correlation_id", default=None,
)


def init_logging(*, service: str, level: str = "info") -> None:
    """Initialise structlog + stdlib logging once per process."""
    log_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        cache_logger_on_first_use=True,
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _add_static_fields(service),
            _add_correlation,
            _redact_secrets,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
    )


def _add_static_fields(service: str):
    hostname = socket.gethostname()
    pid = os.getpid()
    phase = os.environ.get("VIGIL_PHASE", "1")
    env = os.environ.get("NODE_ENV", "production")

    def processor(_logger: WrappedLogger, _name: str, event_dict: EventDict) -> EventDict:
        event_dict.setdefault("service", service)
        event_dict.setdefault("hostname", hostname)
        event_dict.setdefault("pid", pid)
        event_dict.setdefault("phase", phase)
        event_dict.setdefault("env", env)
        return event_dict

    return processor


def _add_correlation(_logger: WrappedLogger, _name: str, event_dict: EventDict) -> EventDict:
    cid = _correlation_id.get()
    if cid is not None:
        event_dict.setdefault("correlation_id", cid)
    return event_dict


_REDACT_KEYS = {
    "password",
    "token",
    "authorization",
    "pin",
    "secret",
    "private_key",
    "api_key",
}


def _redact_secrets(_logger: WrappedLogger, _name: str, event_dict: EventDict) -> EventDict:
    for k in list(event_dict.keys()):
        if k.lower() in _REDACT_KEYS or k.lower().endswith(("_password", "_token", "_secret")):
            event_dict[k] = "[REDACTED]"
    return event_dict


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name) if name else structlog.get_logger()


def bind_correlation(correlation_id: str) -> contextvars.Token[str | None]:
    """Bind a correlation_id to the current context. Returns the reset token."""
    return _correlation_id.set(correlation_id)


def reset_correlation(token: contextvars.Token[str | None]) -> None:
    _correlation_id.reset(token)


def merge_extras(record: MutableMapping[str, Any], **fields: Any) -> dict[str, Any]:
    """Helper used by tests to merge a record with extra fields."""
    return {**record, **fields}
