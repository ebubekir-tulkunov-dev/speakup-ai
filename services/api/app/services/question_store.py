"""Qdrant store for previously asked topic-speak questions."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from app.config import settings

logger = logging.getLogger(__name__)

COLLECTION = "topic_speak_questions"

_client: QdrantClient | None = None


def get_qdrant() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(
            url=settings.qdrant_url,
            prefer_grpc=False,
            timeout=30,
            check_compatibility=False,
        )
    return _client


def ensure_collection() -> None:
    client = get_qdrant()
    names = {c.name for c in client.get_collections().collections}
    if COLLECTION in names:
        return
    client.create_collection(
        collection_name=COLLECTION,
        vectors_config=qm.VectorParams(
            size=settings.qwen_embed_dim,
            distance=qm.Distance.COSINE,
        ),
    )
    client.create_payload_index(
        collection_name=COLLECTION,
        field_name="user_id",
        field_schema=qm.PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=COLLECTION,
        field_name="level",
        field_schema=qm.PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=COLLECTION,
        field_name="asked_at",
        field_schema=qm.PayloadSchemaType.DATETIME,
    )
    logger.info("Created Qdrant collection %s", COLLECTION)


def _must_user_level(user_id: str, level: str | None) -> qm.Filter:
    must: list[qm.FieldCondition] = [
        qm.FieldCondition(key="user_id", match=qm.MatchValue(value=user_id)),
    ]
    if level:
        must.append(qm.FieldCondition(key="level", match=qm.MatchValue(value=level)))
    return qm.Filter(must=must)


async def find_similar(
    vector: list[float],
    *,
    user_id: str,
    level: str | None = None,
    limit: int = 20,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[dict[str, Any]]:
    ensure_collection()
    client = get_qdrant()

    must = list(_must_user_level(user_id, level).must or [])
    if since or until:
        rng: dict[str, Any] = {}
        if since:
            rng["gte"] = since.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        if until:
            rng["lte"] = until.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        must.append(qm.FieldCondition(key="asked_at", range=qm.DatetimeRange(**rng)))

    response = client.query_points(
        collection_name=COLLECTION,
        query=vector,
        query_filter=qm.Filter(must=must),
        limit=limit,
        with_payload=True,
    )
    out: list[dict[str, Any]] = []
    for h in response.points:
        payload = h.payload or {}
        out.append(
            {
                "id": str(h.id),
                "score": float(h.score or 0.0),
                "question": payload.get("question", ""),
                "topic": payload.get("topic", ""),
                "level": payload.get("level", ""),
                "asked_at": payload.get("asked_at"),
                "mongo_id": payload.get("mongo_id"),
            }
        )
    return out


def upsert_question(
    *,
    vector: list[float],
    user_id: str,
    question: str,
    topic: str,
    level: str,
    mongo_id: str,
    asked_at: datetime | None = None,
    point_id: str | None = None,
) -> str:
    ensure_collection()
    client = get_qdrant()
    pid = point_id or str(uuid.uuid4())
    when = asked_at or datetime.now(timezone.utc)
    client.upsert(
        collection_name=COLLECTION,
        points=[
            qm.PointStruct(
                id=pid,
                vector=vector,
                payload={
                    "user_id": user_id,
                    "question": question,
                    "topic": topic,
                    "level": level,
                    "mongo_id": mongo_id,
                    "asked_at": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                },
            )
        ],
    )
    return pid
