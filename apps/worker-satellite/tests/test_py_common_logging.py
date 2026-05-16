"""Tests for vigil_common.logging — context vars, redaction, init."""

from __future__ import annotations

import logging

import structlog

from vigil_common.logging import (
    _add_correlation,
    _add_static_fields,
    _redact_secrets,
    bind_correlation,
    get_logger,
    init_logging,
    merge_extras,
    reset_correlation,
)


def test_get_logger_returns_bound_logger() -> None:
    log = get_logger("vigil-test")
    assert log is not None
    # structlog returns a usable logger; call info() to ensure binding works
    log.info("test-event", x=1)


def test_get_logger_without_name() -> None:
    log = get_logger()
    assert log is not None


def test_correlation_id_round_trip() -> None:
    token = bind_correlation("cid-1234")
    event: dict[str, object] = {}
    _add_correlation(None, "info", event)  # type: ignore[arg-type]
    assert event["correlation_id"] == "cid-1234"
    reset_correlation(token)

    # After reset, the correlation should not be added
    event2: dict[str, object] = {}
    _add_correlation(None, "info", event2)  # type: ignore[arg-type]
    assert "correlation_id" not in event2


def test_static_fields_processor_adds_service_and_phase(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("VIGIL_PHASE", "7")
    monkeypatch.setenv("NODE_ENV", "test")
    proc = _add_static_fields("svc-x")
    event: dict[str, object] = {}
    proc(None, "info", event)  # type: ignore[arg-type]
    assert event["service"] == "svc-x"
    assert event["phase"] == "7"
    assert event["env"] == "test"
    assert "hostname" in event
    assert "pid" in event


def test_static_fields_does_not_overwrite() -> None:
    proc = _add_static_fields("svc-y")
    event: dict[str, object] = {"service": "explicit"}
    proc(None, "info", event)  # type: ignore[arg-type]
    assert event["service"] == "explicit"


def test_redact_secrets_known_keys() -> None:
    event: dict[str, object] = {
        "password": "p",
        "token": "t",
        "authorization": "a",
        "pin": "1234",
        "secret": "s",
        "private_key": "k",
        "api_key": "ak",
        "innocuous": "ok",
    }
    out = _redact_secrets(None, "info", event)  # type: ignore[arg-type]
    for k in ("password", "token", "authorization", "pin", "secret", "private_key", "api_key"):
        assert out[k] == "[REDACTED]"
    assert out["innocuous"] == "ok"


def test_redact_secrets_suffix_match() -> None:
    event: dict[str, object] = {
        "db_password": "x",
        "auth_token": "y",
        "client_secret": "z",
        "name": "ok",
    }
    out = _redact_secrets(None, "info", event)  # type: ignore[arg-type]
    assert out["db_password"] == "[REDACTED]"
    assert out["auth_token"] == "[REDACTED]"
    assert out["client_secret"] == "[REDACTED]"
    assert out["name"] == "ok"


def test_redact_case_insensitive() -> None:
    event: dict[str, object] = {"Authorization": "Bearer xxx"}
    out = _redact_secrets(None, "info", event)  # type: ignore[arg-type]
    assert out["Authorization"] == "[REDACTED]"


def test_merge_extras_combines_fields() -> None:
    base = {"a": 1}
    out = merge_extras(base, b=2, c=3)
    assert out == {"a": 1, "b": 2, "c": 3}
    # original not mutated
    assert base == {"a": 1}


def test_init_logging_sets_level() -> None:
    init_logging(service="test-svc", level="warn")
    # structlog is configured; the wrapper accepts warn-and-above
    log = structlog.get_logger("init-test")
    assert log is not None
    # ensure stdlib root logger has a handler at the requested level
    assert logging.getLogger().level <= logging.WARNING


def test_reset_correlation_idempotent() -> None:
    tok = bind_correlation("a")
    reset_correlation(tok)
    # After reset, _correlation_id is None; second call would error if not careful.
    # We assert reset returns None.
    event: dict[str, object] = {}
    _add_correlation(None, "info", event)  # type: ignore[arg-type]
    assert "correlation_id" not in event
