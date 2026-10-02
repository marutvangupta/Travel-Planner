"""Frankfurter (ECB reference rates), free and keyless."""

from __future__ import annotations

from ..common import http_json

URL = "https://api.frankfurter.dev/v1/latest"


async def rate(from_ccy: str, to_ccy: str) -> tuple[float, str]:
    data = await http_json("GET", URL, params={"base": from_ccy, "symbols": to_ccy})
    return float(data["rates"][to_ccy]), str(data.get("date", ""))
