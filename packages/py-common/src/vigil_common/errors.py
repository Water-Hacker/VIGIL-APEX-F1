"""Error hierarchy mirroring `@vigil/shared/errors`.

Every consequential failure subclasses :class:`VigilError`; callers route on
``code`` / ``retryable`` / ``severity`` rather than instanceof chains.
"""

from __future__ import annotations

from typing import Any, Literal

Severity = Literal["info", "warn", "error", "fatal"]


class VigilError(Exception):
    """Base class for every domain error in the Python workers."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool = False,
        severity: Severity = "error",
        context: dict[str, Any] | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.severity: Severity = severity
        self.context: dict[str, Any] = dict(context or {})
        self.__cause__ = cause

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.__class__.__name__,
            "code": self.code,
            "message": str(self),
            "retryable": self.retryable,
            "severity": self.severity,
            "context": self.context,
        }


# Adapter / data-source errors
class SourceUnavailableError(VigilError):
    pass


class SourceParseError(VigilError):
    pass


class SourceBlockedError(VigilError):
    pass


# LLM-style errors aren't used Python-side; we only need image/satellite analogues
class SatelliteFetchError(VigilError):
    pass


class ImageForensicsError(VigilError):
    pass


def asVigilError(e: BaseException) -> VigilError:
    """Wrap any exception into a VigilError so callers can route uniformly."""
    if isinstance(e, VigilError):
        return e
    return VigilError(
        code="UNCATEGORISED",
        message=str(e) or e.__class__.__name__,
        severity="error",
        cause=e,
    )
