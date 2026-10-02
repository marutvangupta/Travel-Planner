"""Long-term memory: an editable preference profile, feedback-driven category weights, and embedded
"learned preference" memories with provenance that the user can inspect and delete."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Feedback, UserMemory, UserPreference
from .embeddings import cosine, embed_texts, embedder_id

SIGNAL_DELTA = {"up": 0.15, "down": -0.2, "removed": -0.25, "kept": 0.05}
INFER_THRESHOLD = 0.4


def get_prefs(db: Session, user_id: str) -> UserPreference:
    prefs = db.get(UserPreference, user_id)
    if prefs is None:
        prefs = UserPreference(user_id=user_id, interests=[], avoid=[], category_weights={})
        db.add(prefs)
        db.flush()
    return prefs


def add_memory(db: Session, user_id: str, content: str, *, kind: str = "inferred", confidence: float = 0.5,
               trip_id: str | None = None, evidence: str | None = None) -> UserMemory:
    existing = db.scalar(select(UserMemory).where(
        UserMemory.user_id == user_id, UserMemory.content == content, UserMemory.deleted_at.is_(None)))
    if existing:
        existing.confidence = max(existing.confidence, confidence)
        existing.evidence = evidence or existing.evidence
        return existing
    mem = UserMemory(user_id=user_id, content=content, kind=kind, confidence=confidence, source_trip_id=trip_id,
                     evidence=evidence, embedding=embed_texts([content])[0], embed_model=embedder_id())
    db.add(mem)
    db.flush()
    return mem


def list_memories(db: Session, user_id: str) -> list[UserMemory]:
    return list(db.scalars(select(UserMemory).where(
        UserMemory.user_id == user_id, UserMemory.deleted_at.is_(None)).order_by(UserMemory.created_at.desc())).all())


def retrieve_memories(db: Session, user_id: str, query: str, k: int = 4) -> list[UserMemory]:
    mems = list_memories(db, user_id)
    if not mems:
        return []
    qvec = embed_texts([query])[0]
    emb = embedder_id()
    scored = []
    for m in mems:
        sim = cosine(qvec, m.embedding or []) if m.embed_model == emb else 0.0
        boost = 1.0 if m.kind == "explicit" else 0.0  # explicit statements are always relevant
        scored.append((sim + boost + 0.1 * m.confidence, m))
    scored.sort(key=lambda t: -t[0])
    return [m for score, m in scored[:k] if score > 0.12]


def apply_feedback(db: Session, user_id: str, trip_id: str, *, item_id: str | None, place_id: str | None,
                   category: str | None, tags: list[str], signal: str) -> dict:
    db.add(Feedback(user_id=user_id, trip_id=trip_id, item_id=item_id, place_id=place_id, category=category,
                    tags=tags, signal=signal))
    prefs = get_prefs(db, user_id)
    weights = dict(prefs.category_weights or {})
    delta = SIGNAL_DELTA.get(signal, 0.0)
    # the place type carries most of the signal; its interest tags move at half speed so one disliked museum
    # does not turn into "dislikes history" or "dislikes culture"
    for tag in tags:
        weights[tag] = round(max(-1.0, min(1.0, weights.get(tag, 0.0) + delta / 2)), 3)
    if category:
        weights[category] = round(max(-1.0, min(1.0, weights.get(category, 0.0) + delta)), 3)
    prefs.category_weights = weights
    prefs.updated_at = datetime.now(UTC)
    db.flush()
    created = infer_memories(db, user_id, trip_id, touched=[*tags, *([category] if category else [])])
    return {"weights": weights, "new_memories": [m.content for m in created]}


def infer_memories(db: Session, user_id: str, trip_id: str | None, touched: list[str]) -> list[UserMemory]:
    prefs = get_prefs(db, user_id)
    created: list[UserMemory] = []
    for term in dict.fromkeys(touched):
        w = (prefs.category_weights or {}).get(term, 0.0)
        if abs(w) < INFER_THRESHOLD:
            continue
        wanted = ["down", "removed"] if w < 0 else ["up", "kept"]
        rows = db.scalars(select(Feedback).where(Feedback.user_id == user_id, Feedback.signal.in_(wanted))).all()
        count = sum(1 for f in rows if f.category == term or term in (f.tags or []))
        content = f"Tends to skip {term} stops" if w < 0 else f"Enjoys {term} stops"
        evidence = f"Based on {max(count, 1)} {'removals or thumbs-down' if w < 0 else 'thumbs-up'} on {term} places (weight {w:+.2f})"
        created.append(add_memory(db, user_id, content, kind="inferred", confidence=min(1.0, abs(w)),
                                  trip_id=trip_id, evidence=evidence))
    return created


def delete_memory(db: Session, user_id: str, memory_id: str) -> bool:
    mem = db.get(UserMemory, memory_id)
    if not mem or mem.user_id != user_id or mem.deleted_at:
        return False
    mem.deleted_at = datetime.now(UTC)
    return True
