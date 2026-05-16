"""Tests for vigil_common.vault — VaultClient with mocked hvac."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import tenacity

from vigil_common.errors import VigilError
from vigil_common.secrets import Secret, expose
from vigil_common.vault import VaultClient


def _mk_client(read_return: dict | Exception) -> VaultClient:
    """Build a VaultClient whose internal hvac.Client has a stubbed read."""
    fake_hvac = MagicMock()
    if isinstance(read_return, Exception):
        fake_hvac.secrets.kv.v2.read_secret_version.side_effect = read_return
    else:
        fake_hvac.secrets.kv.v2.read_secret_version.return_value = read_return
    with patch("vigil_common.vault.hvac.Client", return_value=fake_hvac):
        return VaultClient(addr="http://vault:8200", token=Secret("t"))


def test_vault_read_returns_field_value() -> None:
    vc = _mk_client({"data": {"data": {"api_key": "abc123"}}})
    s = vc.read("kv/path", "api_key")
    assert isinstance(s, Secret)
    assert expose(s) == "abc123"


def test_vault_read_missing_field_raises() -> None:
    vc = _mk_client({"data": {"data": {"other_field": "x"}}})
    # `read` is wrapped in tenacity.retry; after 3 attempts a RetryError surfaces.
    with pytest.raises((VigilError, tenacity.RetryError)) as exc:
        vc.read("kv/path", "api_key")
    # Unwrap if RetryError
    inner = exc.value
    if isinstance(inner, tenacity.RetryError):
        underlying = inner.last_attempt.exception()
        assert isinstance(underlying, VigilError)
        assert underlying.code == "VAULT_FIELD_MISSING"
    else:
        assert inner.code == "VAULT_FIELD_MISSING"


def test_vault_read_propagates_failure_as_vigil_error() -> None:
    vc = _mk_client(RuntimeError("connection refused"))
    with pytest.raises((VigilError, tenacity.RetryError)) as exc:
        vc.read("kv/path", "api_key")
    inner = exc.value
    if isinstance(inner, tenacity.RetryError):
        underlying = inner.last_attempt.exception()
        assert isinstance(underlying, VigilError)
        assert underlying.code == "VAULT_READ_FAILED"
    else:
        assert inner.code == "VAULT_READ_FAILED"


def test_vault_read_coerces_non_string_value_to_str() -> None:
    vc = _mk_client({"data": {"data": {"port": 5432}}})
    s = vc.read("kv/path", "port")
    assert expose(s) == "5432"


def test_vault_from_settings_reads_token_file(tmp_path: Path) -> None:
    token_path = tmp_path / "tok"
    token_path.write_text("vault-token-XYZ", encoding="utf-8")
    with patch("vigil_common.vault.hvac.Client") as ctor:
        VaultClient.from_settings(addr="http://vault:8200", token_file=str(token_path))
    # The hvac.Client constructor was called with the exposed token value
    ctor.assert_called_once()
    kwargs = ctor.call_args.kwargs
    assert kwargs.get("token") == "vault-token-XYZ"
    assert kwargs.get("url") == "http://vault:8200"


def test_vault_start_renew_is_idempotent() -> None:
    vc = _mk_client({"data": {"data": {}}})
    vc.start_renew(interval_s=0.01)
    first_thread = vc._renew_thread
    # Second call must not spawn a second thread
    vc.start_renew(interval_s=0.01)
    assert vc._renew_thread is first_thread
    # Cleanup — set the stop event so the background thread can exit
    vc._stop_event.set()
    if vc._renew_thread is not None:
        vc._renew_thread.join(timeout=1)
