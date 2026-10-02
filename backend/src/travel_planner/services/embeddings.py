"""Embeddings: OpenAI when a key is configured, otherwise a deterministic hashed bag-of-words embedder.

The hashed fallback is lexical (like BM25 in vector form). It keeps the app and evals runnable offline,
but it is not semantic; the retrieval eval reports which embedder produced the numbers.
"""

from __future__ import annotations

import hashlib
import math
import re

from ..config import get_settings
from .tracking import current_tracker

_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "be", "it", "at", "by",
    "from", "as", "that", "this", "you", "your", "can", "will", "do", "i", "me", "my", "we", "what", "how",
}


def embedder_id() -> str:
    s = get_settings()
    return s.openai_embedding_model if s.llm_enabled else f"hash-{s.embedding_dim}"


def _stem(tok: str) -> str:
    for suf in ("ing", "es", "s"):
        if tok.endswith(suf) and len(tok) - len(suf) >= 4:
            return tok[: -len(suf)]
    return tok


def tokenize(text: str) -> list[str]:
    return [_stem(t) for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOP]


def hash_embed(text: str, dim: int) -> list[float]:
    vec = [0.0] * dim
    toks = tokenize(text)
    feats = [(t, 1.0) for t in toks] + [(f"{a}_{b}", 0.6) for a, b in zip(toks, toks[1:], strict=False)]
    for tok, weight in feats:
        h = hashlib.md5(tok.encode()).digest()
        idx = int.from_bytes(h[:4], "big") % dim
        sign = 1.0 if h[4] & 1 else -1.0
        vec[idx] += sign * weight
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed_texts(texts: list[str]) -> list[list[float]]:
    s = get_settings()
    if not texts:
        return []
    if s.llm_enabled:
        from openai import OpenAI

        client = OpenAI(api_key=s.openai_api_key)
        resp = client.embeddings.create(model=s.openai_embedding_model, input=texts)
        usage = getattr(resp, "usage", None)
        if usage:
            current_tracker().add_llm(s.openai_embedding_model, usage.prompt_tokens, 0)
        return [d.embedding for d in resp.data]
    return [hash_embed(t, s.embedding_dim) for t in texts]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
