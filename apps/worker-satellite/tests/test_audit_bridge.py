"""Tests for vigil_satellite.audit_bridge — HTTP-over-UDS client.

We don't run a real UDS server; we mock socket.socket and verify the
request bytes + response parsing branches.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from vigil_satellite.audit_bridge import AuditBridgeClient, AuditBridgeResult


def _fake_socket(response_bytes: bytes) -> MagicMock:
    """Return a context-manager-style fake socket that yields `response_bytes`."""
    fake_sock = MagicMock()
    # recv() returns response in one chunk, then empty
    fake_sock.recv.side_effect = [response_bytes, b""]
    cm = MagicMock()
    cm.__enter__.return_value = fake_sock
    cm.__exit__.return_value = False
    return cm, fake_sock


def test_audit_bridge_result_dataclass() -> None:
    r = AuditBridgeResult(seq=1, body_hash="abcd")
    assert r.seq == 1
    assert r.body_hash == "abcd"


def test_audit_bridge_returns_none_on_socket_error() -> None:
    """OSError on connect ⇒ warn-log + None."""
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    fake_sock = MagicMock()
    fake_sock.connect.side_effect = OSError("connection refused")
    cm = MagicMock()
    cm.__enter__.return_value = fake_sock
    cm.__exit__.return_value = False
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(
            action="x.y",
            actor="test",
            subject_kind="finding",
            subject_id="42",
            payload={"k": "v"},
        )
    assert result is None


def test_audit_bridge_returns_none_on_timeout() -> None:
    """TimeoutError on connect ⇒ warn-log + None."""
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    fake_sock = MagicMock()
    fake_sock.connect.side_effect = TimeoutError("slow")
    cm = MagicMock()
    cm.__enter__.return_value = fake_sock
    cm.__exit__.return_value = False
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(action="a", actor="b", subject_kind="c", subject_id="d", payload={})
    assert result is None


def test_audit_bridge_parses_200_response() -> None:
    body = json.dumps({"seq": 17, "body_hash": "deadbeef"}).encode()
    response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" + body
    cm, _ = _fake_socket(response)
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(
            action="satellite.imagery_fetched",
            actor="worker-satellite/test",
            subject_kind="finding",
            subject_id="F1",
            payload={"x": 1},
        )
    assert result is not None
    assert result.seq == 17
    assert result.body_hash == "deadbeef"


def test_audit_bridge_returns_none_on_non_200() -> None:
    response = b"HTTP/1.1 500 Internal Server Error\r\n\r\ninternal error"
    cm, _ = _fake_socket(response)
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(action="a", actor="b", subject_kind="c", subject_id="d", payload={})
    assert result is None


def test_audit_bridge_returns_none_on_malformed_status_line() -> None:
    """Empty / unparseable status line ⇒ status=0 ⇒ warn + None."""
    response = b"GARBAGE\r\n\r\n"
    cm, _ = _fake_socket(response)
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(action="a", actor="b", subject_kind="c", subject_id="d", payload={})
    assert result is None


def test_audit_bridge_returns_none_on_invalid_json_body() -> None:
    response = b"HTTP/1.1 200 OK\r\n\r\nnot-json"
    cm, _ = _fake_socket(response)
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(action="a", actor="b", subject_kind="c", subject_id="d", payload={})
    assert result is None


def test_audit_bridge_returns_none_on_missing_fields() -> None:
    body = json.dumps({"seq": 1}).encode()  # body_hash missing
    response = b"HTTP/1.1 200 OK\r\n\r\n" + body
    cm, _ = _fake_socket(response)
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        result = client.append(action="a", actor="b", subject_kind="c", subject_id="d", payload={})
    assert result is None


def test_audit_bridge_sends_post_append_to_socket() -> None:
    response = b"HTTP/1.1 200 OK\r\n\r\n" + json.dumps({"seq": 1, "body_hash": "h"}).encode()
    cm, sock = _fake_socket(response)
    client = AuditBridgeClient("/run/vigil/audit-bridge.sock")
    with patch("vigil_satellite.audit_bridge.socket.socket", return_value=cm):
        client.append(action="a", actor="b", subject_kind="c", subject_id="d", payload={"foo": 1})
    sock.connect.assert_called_once_with("/run/vigil/audit-bridge.sock")
    # The first positional arg to sendall is the request bytes
    sent = sock.sendall.call_args.args[0]
    assert b"POST /append HTTP/1.1" in sent
    assert b'"action":"a"' in sent
    assert b'"foo":1' in sent
