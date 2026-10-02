"""Travel-guide retrieval: vector + keyword (BM25) fused with Reciprocal Rank Fusion.

Chunks live in the `guide_chunks` table (pgvector column on PostgreSQL). Ranking happens in Python over the
chunks of one destination, which is small by design; swap in `ORDER BY embedding <=> :q` when the corpus grows.
"""

from __future__ import annotations

import math
from collections import Counter

from sqlalchemy import select

from ..db import session_scope
from ..models import GuideChunkRow
from ..schemas import GuideChunk
from ..tools.demo_data import GUIDES
from ..tools.providers.demo import resolve_key
from .embeddings import cosine, embed_texts, embedder_id, tokenize


def destination_key(destination: str) -> str:
    return resolve_key(destination) or destination.strip().lower().split(",")[0]


def ensure_seeded() -> int:
    """Insert (or re-embed after an embedder change) the bundled demo guide notes."""
    emb_id = embedder_id()
    seeded = 0
    with session_scope() as db:
        existing = {r.id: r for r in db.scalars(select(GuideChunkRow)).all()}
        pending: list[tuple[str, str, str, str]] = []
        for dest, rows in GUIDES.items():
            for i, (section, text) in enumerate(rows):
                cid = f"{dest}-{i}"
                row = existing.get(cid)
                if row is None or row.embed_model != emb_id or row.content != text:
                    pending.append((cid, dest, section, text))
        if pending:
            vectors = embed_texts([f"{sec}. {txt}" for _, _, sec, txt in pending])
            for (cid, dest, section, text), vec in zip(pending, vectors, strict=True):
                row = existing.get(cid) or GuideChunkRow(id=cid)
                row.destination, row.section, row.title = dest, section, f"{dest.title()} guide: {section}"
                row.content, row.provider, row.embed_model, row.embedding = text, "curated-demo", emb_id, vec
                db.merge(row)
                seeded += 1
    return seeded


def _bm25(query: str, docs: list[list[str]], k1: float = 1.4, b: float = 0.75) -> list[float]:
    q = tokenize(query)
    n = len(docs)
    avg = sum(len(d) for d in docs) / max(n, 1) or 1.0
    df: Counter[str] = Counter()
    for d in docs:
        df.update(set(d))
    scores = []
    for d in docs:
        tf = Counter(d)
        s = 0.0
        for t in q:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / avg))
        scores.append(s)
    return scores


def _rank(scores: list[float]) -> list[int]:
    return [i for i, _ in sorted(enumerate(scores), key=lambda p: -p[1])]


def search(destination: str, query: str, k: int = 4, mode: str = "hybrid") -> list[GuideChunk]:
    dest = destination_key(destination)
    with session_scope() as db:
        rows = list(db.scalars(select(GuideChunkRow).where(GuideChunkRow.destination == dest)).all())
    if not rows:
        return []
    qvec = embed_texts([query])[0]
    vec_scores = [cosine(qvec, r.embedding or []) for r in rows]
    kw_scores = _bm25(query, [tokenize(f"{r.section} {r.content}") for r in rows])
    if mode == "vector":
        fused = {i: vec_scores[i] for i in range(len(rows))}
    elif mode == "keyword":
        fused = {i: kw_scores[i] for i in range(len(rows))}
    else:
        fused: dict[int, float] = {}
        for ranking in (_rank(vec_scores), _rank(kw_scores)):
            for pos, idx in enumerate(ranking):
                fused[idx] = fused.get(idx, 0.0) + 1.0 / (60 + pos + 1)
    top = sorted(fused, key=lambda i: -fused[i])[:k]
    return [
        GuideChunk(chunk_id=rows[i].id, destination=dest, section=rows[i].section, text=rows[i].content,
                   url=rows[i].url, provider=rows[i].provider, score=round(float(fused[i]), 4))
        for i in top
    ]
