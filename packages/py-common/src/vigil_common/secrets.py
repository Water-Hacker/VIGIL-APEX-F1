"""Secret loading helpers.

Workers receive secrets via:
  1. /run/secrets/* files (Docker secrets) — preferred
  2. Vault KV v2 reads at runtime via VaultClient

A loaded secret is wrapped in :class:`Secret` so that accidental string
formatting / logging cannot reveal the value. Use :func:`expose` only at the
point of use (e.g. when building an HTTP header).
"""

from __future__ import annotations

from pathlib import Path
from typing import TypeVar

from .errors import VigilError

T = TypeVar("T")


class Secret[T]:
    """Opaque wrapper that prints `[Secret]` instead of the underlying value."""

    __slots__ = ("_value",)

    def __init__(self, value: T) -> None:
        self._value = value

    def __repr__(self) -> str:
        return "[Secret]"

    def __str__(self) -> str:
        return "[Secret]"


def expose[T](secret: Secret[T]) -> T:
    return secret._value


def read_secret_file(path: str | Path) -> Secret[str]:
    """Read a Docker secret (one-line file) and wrap it."""
    p = Path(path)
    if not p.exists():
        raise VigilError(
            code="SECRET_FILE_MISSING",
            message=f"secret file missing: {p}",
            severity="fatal",
        )
    raw = p.read_text(encoding="utf-8").strip()
    if not raw:
        raise VigilError(
            code="SECRET_FILE_EMPTY",
            message=f"secret file empty: {p}",
            severity="fatal",
        )
    return Secret(raw)
