"""ORM tables. Itineraries are stored as JSON snapshots per version: free history, diffs and what-if forks."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from .config import get_settings
from .db import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


def _id() -> str:
    return uuid.uuid4().hex[:16]


def _now() -> datetime:
    return datetime.now(UTC)


class EmbeddingType(TypeDecorator):
    """pgvector column on PostgreSQL, JSON list elsewhere."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):  # noqa: ANN001
        if dialect.name == "postgresql":
            try:
                from pgvector.sqlalchemy import Vector

                return dialect.type_descriptor(Vector(get_settings().embedding_dim))
            except ImportError:
                return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        return None if value is None else [float(x) for x in value]

    def process_result_value(self, value, dialect):  # noqa: ANN001
        return None if value is None else [float(x) for x in value]


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UserPreference(Base):
    __tablename__ = "user_preferences"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    pace: Mapped[str] = mapped_column(String(16), default="balanced")
    travel_style: Mapped[str] = mapped_column(String(16), default="balanced")
    diet: Mapped[str] = mapped_column(String(16), default="none")
    step_free: Mapped[bool] = mapped_column(Boolean, default=False)
    interests: Mapped[list] = mapped_column(JSONType, default=list)
    avoid: Mapped[list] = mapped_column(JSONType, default=list)
    category_weights: Mapped[dict] = mapped_column(JSONType, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class UserMemory(Base):
    __tablename__ = "user_memories"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list | None] = mapped_column(EmbeddingType, nullable=True)
    embed_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="inferred")  # explicit | inferred
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    source_trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Trip(Base):
    __tablename__ = "trips"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    destination: Mapped[str] = mapped_column(String(160))
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    budget_inr: Mapped[int] = mapped_column(Integer)
    request: Mapped[dict] = mapped_column(JSONType)
    current_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ItineraryVersion(Base):
    __tablename__ = "itinerary_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    parent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    itinerary: Mapped[dict] = mapped_column(JSONType)
    change_reason: Mapped[str] = mapped_column(Text, default="")
    change_type: Mapped[str] = mapped_column(String(16), default="create")  # create|edit|replan|whatif
    status: Mapped[str] = mapped_column(String(16), default="applied")  # applied|proposed|rejected
    diff: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    affected: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    violations: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    metrics: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChangeEvent(Base):
    __tablename__ = "change_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(24))  # weather|availability|budget|pref|user_edit
    payload: Mapped[dict] = mapped_column(JSONType, default=dict)
    affected_item_ids: Mapped[list] = mapped_column(JSONType, default=list)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|resolved|dismissed
    proposed_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(12))  # user|assistant
    content: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    place_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tags: Mapped[list] = mapped_column(JSONType, default=list)
    signal: Mapped[str] = mapped_column(String(12))  # up|down|removed|kept
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GuideChunkRow(Base):
    __tablename__ = "guide_chunks"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    destination: Mapped[str] = mapped_column(String(80), index=True)
    section: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    provider: Mapped[str] = mapped_column(String(40), default="curated-demo")
    embed_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    embedding: Mapped[list | None] = mapped_column(EmbeddingType, nullable=True)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    trip_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    workflow: Mapped[str] = mapped_column(String(16))
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    planner: Mapped[str] = mapped_column(String(16), default="heuristic")
    models: Mapped[list] = mapped_column(JSONType, default=list)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    tool_errors: Mapped[int] = mapped_column(Integer, default=0)
    cache_hits: Mapped[int] = mapped_column(Integer, default=0)
    repair_loops: Mapped[int] = mapped_column(Integer, default=0)
    node_timings: Mapped[dict] = mapped_column(JSONType, default=dict)
    status: Mapped[str] = mapped_column(String(12), default="ok")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
