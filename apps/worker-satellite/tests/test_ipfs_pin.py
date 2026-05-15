"""Tests for the IPFS pinner client."""

from __future__ import annotations

from unittest.mock import patch

import httpx

from vigil_satellite.ipfs import IpfsPinner


def test_pin_json_returns_cid_on_success() -> None:
    pinner = IpfsPinner("http://ipfs:5001")
    response = httpx.Response(
        status_code=200,
        text='{"Name":"result.json","Hash":"bafytest123","Size":"42"}\n',
    )
    with patch.object(httpx, "post", return_value=response):
        cid = pinner.pin_json({"x": 1})
    assert cid == "bafytest123"


def test_pin_json_returns_none_on_http_error() -> None:
    pinner = IpfsPinner("http://ipfs:5001")
    with patch.object(httpx, "post", side_effect=httpx.ConnectError("boom")):
        cid = pinner.pin_json({"x": 1})
    assert cid is None


def test_pin_json_returns_none_on_non_200() -> None:
    pinner = IpfsPinner("http://ipfs:5001")
    response = httpx.Response(status_code=503, text="unavailable")
    with patch.object(httpx, "post", return_value=response):
        cid = pinner.pin_json({"x": 1})
    assert cid is None


def test_pin_json_returns_none_on_malformed_response() -> None:
    pinner = IpfsPinner("http://ipfs:5001")
    response = httpx.Response(status_code=200, text="not-json")
    with patch.object(httpx, "post", return_value=response):
        cid = pinner.pin_json({"x": 1})
    assert cid is None
