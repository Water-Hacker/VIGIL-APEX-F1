"""Tests for vigil_common.errors — VigilError + asVigilError wrapper."""

from __future__ import annotations

from vigil_common.errors import (
    ImageForensicsError,
    SatelliteFetchError,
    SourceBlockedError,
    SourceParseError,
    SourceUnavailableError,
    VigilError,
    asVigilError,
)


def test_vigil_error_to_dict_round_trip() -> None:
    err = VigilError(
        code="X_CODE",
        message="something failed",
        retryable=True,
        severity="warn",
        context={"foo": "bar", "n": 3},
    )
    d = err.to_dict()
    assert d["name"] == "VigilError"
    assert d["code"] == "X_CODE"
    assert d["message"] == "something failed"
    assert d["retryable"] is True
    assert d["severity"] == "warn"
    assert d["context"] == {"foo": "bar", "n": 3}


def test_vigil_error_defaults() -> None:
    err = VigilError(code="DEFAULT", message="m")
    assert err.retryable is False
    assert err.severity == "error"
    assert err.context == {}


def test_vigil_error_with_cause() -> None:
    cause = ValueError("root")
    err = VigilError(code="WRAP", message="outer", cause=cause)
    assert err.__cause__ is cause


def test_as_vigil_error_passthrough() -> None:
    src = VigilError(code="PRE", message="m")
    out = asVigilError(src)
    assert out is src


def test_as_vigil_error_wraps_generic_exception() -> None:
    src = RuntimeError("boom")
    out = asVigilError(src)
    assert isinstance(out, VigilError)
    assert out.code == "UNCATEGORISED"
    assert "boom" in str(out)
    assert out.__cause__ is src


def test_as_vigil_error_falls_back_to_class_name_when_no_message() -> None:
    class CustomError(Exception):
        pass

    out = asVigilError(CustomError())
    assert isinstance(out, VigilError)
    # Empty message ⇒ str(e) == "" ⇒ class name fallback
    assert out.code == "UNCATEGORISED"
    assert "CustomError" in str(out)


def test_subclasses_inherit_to_dict() -> None:
    for cls in (
        SourceUnavailableError,
        SourceParseError,
        SourceBlockedError,
        SatelliteFetchError,
        ImageForensicsError,
    ):
        e = cls(code="C", message="m")
        d = e.to_dict()
        assert d["name"] == cls.__name__
        assert d["code"] == "C"
