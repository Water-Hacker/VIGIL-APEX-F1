"""Tests for vigil_common.secrets — Secret wrapper + read_secret_file."""

from __future__ import annotations

from pathlib import Path

import pytest

from vigil_common.errors import VigilError
from vigil_common.secrets import Secret, expose, read_secret_file


def test_secret_repr_does_not_leak_value() -> None:
    s = Secret("super-secret-token")
    assert repr(s) == "[Secret]"
    assert str(s) == "[Secret]"
    assert "super-secret-token" not in repr(s)
    assert "super-secret-token" not in str(s)


def test_expose_returns_underlying_value() -> None:
    s = Secret("plain-value")
    assert expose(s) == "plain-value"


def test_secret_supports_non_string_values() -> None:
    s = Secret(42)
    assert expose(s) == 42
    assert str(s) == "[Secret]"


def test_read_secret_file_success(tmp_path: Path) -> None:
    p = tmp_path / "token"
    p.write_text("hunter2\n", encoding="utf-8")
    s = read_secret_file(p)
    assert expose(s) == "hunter2"


def test_read_secret_file_strips_whitespace(tmp_path: Path) -> None:
    p = tmp_path / "token"
    p.write_text("   abc-def   \n\n", encoding="utf-8")
    s = read_secret_file(p)
    assert expose(s) == "abc-def"


def test_read_secret_file_missing_raises(tmp_path: Path) -> None:
    p = tmp_path / "missing"
    with pytest.raises(VigilError) as exc:
        read_secret_file(p)
    assert exc.value.code == "SECRET_FILE_MISSING"
    assert exc.value.severity == "fatal"


def test_read_secret_file_empty_raises(tmp_path: Path) -> None:
    p = tmp_path / "empty"
    p.write_text("   \n", encoding="utf-8")
    with pytest.raises(VigilError) as exc:
        read_secret_file(p)
    assert exc.value.code == "SECRET_FILE_EMPTY"


def test_read_secret_file_accepts_str_path(tmp_path: Path) -> None:
    p = tmp_path / "tok"
    p.write_text("xyz", encoding="utf-8")
    s = read_secret_file(str(p))
    assert expose(s) == "xyz"
