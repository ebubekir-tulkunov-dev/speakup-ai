"""Topic Speak: level-based oral Q&A with Qdrant duplicate detection + Deepgram STT."""

from __future__ import annotations

import logging
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.config import settings
from app.models import TopicSpeakQuestion
from app.services.ai_client import ai_post
from app.services.deepgram_transcribe import transcribe_audio_bytes
from app.services import question_store
from app.services.qwen_embed import embed_document, embed_query
from app.services.qwen_rerank import rerank

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/topic-speak", tags=["topic-speak"])

TOPIC_POOL = [
    "daily life",
    "food and cooking",
    "travel and cities",
    "work and career",
    "education and learning",
    "health and fitness",
    "technology and internet",
    "environment and nature",
    "culture and traditions",
    "sports and hobbies",
    "family and relationships",
    "money and shopping",
    "media and entertainment",
    "future plans and dreams",
    "society and community",
    "science and discovery",
    "weather and seasons",
    "friends and social life",
]


class NextQuestionBody(BaseModel):
    level: str = "B1"
    topic: str | None = None  # None / "" = random diverse topic
    prefer_fresh_days: int | None = Field(
        default=None,
        ge=1,
        le=365,
        description="If set, also search history within this many days for duplicates",
    )


class AnswerTextBody(BaseModel):
    question_id: str
    transcript: str = Field(..., min_length=1)


def _serialize(q: TopicSpeakQuestion) -> dict[str, Any]:
    return {
        "id": str(q.id),
        "level": q.level,
        "topic": q.topic,
        "question": q.question,
        "question_tr": q.question_tr,
        "hint_tr": q.hint_tr,
        "target_words": q.target_words or [],
        "target_patterns": q.target_patterns or [],
        "transcript": q.transcript,
        "evaluation": q.evaluation,
        "status": q.status,
        "asked_at": q.asked_at.isoformat() if q.asked_at else None,
        "answered_at": q.answered_at.isoformat() if q.answered_at else None,
    }


async def _check_duplicate(candidate: str, hits: list[dict]) -> tuple[bool, dict | None]:
    threshold = settings.topic_speak_similarity_threshold
    if not hits:
        return False, None

    top = hits[0]
    if top["score"] >= max(threshold + 0.08, 0.92):
        return True, top

    docs = [h["question"] for h in hits if h.get("question")]
    if not docs:
        return False, None

    ranked = await rerank(candidate, docs, top_n=min(5, len(docs)))
    if not ranked:
        return top["score"] >= threshold, top if top["score"] >= threshold else None

    best = ranked[0]
    best_hit = hits[best["index"]] if 0 <= best["index"] < len(hits) else top
    if best["score"] >= threshold:
        return True, {**best_hit, "rerank_score": best["score"]}
    if top["score"] >= threshold and best["score"] >= threshold - 0.12:
        return True, {**best_hit, "rerank_score": best["score"]}
    return False, None


@router.post("/next")
async def next_question(body: NextQuestionBody):
    user_id = settings.default_user_id
    level = body.level.strip().upper() or "B1"

    try:
        question_store.ensure_collection()
    except Exception as e:
        raise HTTPException(
            503,
            f"Qdrant erişilemiyor ({settings.qdrant_url}). Docker ile başlatın: "
            f"cd docker && docker compose up -d qdrant — {e}",
        ) from e

    exclude_topics: list[str] = []
    # Recent topics from Mongo to encourage variety
    recent = (
        await TopicSpeakQuestion.find(TopicSpeakQuestion.user_id == user_id)
        .sort(-TopicSpeakQuestion.asked_at)
        .limit(12)
        .to_list()
    )
    exclude_topics = [r.topic for r in recent if r.topic]
    recent_questions = [r.question for r in recent if r.question][:8]

    since = None
    if body.prefer_fresh_days:
        from datetime import timedelta

        since = datetime.now(timezone.utc) - timedelta(days=body.prefer_fresh_days)

    last_dup: dict | None = None
    chosen: dict | None = None

    for attempt in range(5):
        topic = (body.topic or "").strip()
        if not topic:
            pool = [t for t in TOPIC_POOL if t not in exclude_topics[:6]] or TOPIC_POOL
            topic = random.choice(pool)

        try:
            generated = await ai_post(
                "/generate/topic-question",
                {
                    "level": level,
                    "topic": topic,
                    "exclude_questions": recent_questions,
                    "exclude_topics": exclude_topics[:8],
                },
            )
        except Exception as e:
            raise HTTPException(502, f"Soru üretilemedi: {e}") from e

        question = (generated.get("question") or "").strip()
        if not question:
            continue

        topic_label = (generated.get("topic") or topic).strip()
        question_tr = generated.get("question_tr")
        hint_tr = generated.get("hint_tr")
        target_words = generated.get("target_words") or []
        if not isinstance(target_words, list):
            target_words = []
        target_patterns = generated.get("target_patterns") or []
        if not isinstance(target_patterns, list):
            target_patterns = []

        try:
            query_vec = await embed_query(question)
            hits = await question_store.find_similar(
                query_vec,
                user_id=user_id,
                level=level,
                limit=20,
                since=since,
            )
            # Also search all-time if prefer_fresh_days filtered too hard
            if since and len(hits) < 5:
                hits_all = await question_store.find_similar(
                    query_vec, user_id=user_id, level=level, limit=20
                )
                seen_ids = {h["id"] for h in hits}
                for h in hits_all:
                    if h["id"] not in seen_ids:
                        hits.append(h)

            is_dup, dup_info = await _check_duplicate(question, hits)
        except Exception as e:
            logger.warning("Duplicate check failed, accepting question: %s", e)
            is_dup, dup_info = False, None

        if is_dup:
            last_dup = dup_info
            if dup_info and dup_info.get("topic"):
                exclude_topics.append(dup_info["topic"])
            recent_questions.insert(0, question)
            continue

        chosen = {
            "question": question,
            "topic": topic_label,
            "question_tr": question_tr,
            "hint_tr": hint_tr,
            "target_words": target_words,
            "target_patterns": target_patterns,
            "vector": await embed_document(question),
        }
        break

    if not chosen:
        raise HTTPException(
            409,
            "Benzer soru zaten sorulmuş görünüyor; birkaç saniye sonra tekrar deneyin.",
        )

    doc = TopicSpeakQuestion(
        user_id=user_id,
        level=level,
        topic=chosen["topic"],
        question=chosen["question"],
        question_tr=chosen.get("question_tr"),
        hint_tr=chosen.get("hint_tr"),
        target_words=chosen.get("target_words") or [],
        target_patterns=chosen.get("target_patterns") or [],
        status="asked",
    )
    await doc.insert()

    try:
        qid = question_store.upsert_question(
            vector=chosen["vector"],
            user_id=user_id,
            question=chosen["question"],
            topic=chosen["topic"],
            level=level,
            mongo_id=str(doc.id),
            asked_at=doc.asked_at.replace(tzinfo=timezone.utc)
            if doc.asked_at.tzinfo is None
            else doc.asked_at,
        )
        doc.qdrant_id = qid
        await doc.save()
    except Exception as e:
        logger.exception("Failed to upsert question into Qdrant: %s", e)

    return {
        **_serialize(doc),
        "duplicate_avoided": last_dup is not None,
        "near_match": last_dup,
    }


@router.post("/answer")
async def answer_with_audio(
    question_id: str = Form(...),
    audio: UploadFile = File(...),
):
    user_id = settings.default_user_id
    doc = await TopicSpeakQuestion.get(question_id)
    if not doc or doc.user_id != user_id:
        raise HTTPException(404, "Soru bulunamadı")

    if not settings.deepgram_api_key:
        raise HTTPException(503, "DEEPGRAM_API_KEY yapılandırılmamış")

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "Boş ses dosyası")

    content_type = audio.content_type or "audio/webm"
    try:
        transcript = await transcribe_audio_bytes(
            raw,
            settings.deepgram_api_key,
            language="en",
            content_type=content_type,
        )
    except Exception as e:
        raise HTTPException(502, f"Transkripsiyon hatası: {e}") from e

    if not transcript:
        raise HTTPException(400, "Ses anlaşılamadı; tekrar kaydedin")

    return await _evaluate_and_save(doc, transcript)


@router.post("/answer-text")
async def answer_with_text(body: AnswerTextBody):
    user_id = settings.default_user_id
    doc = await TopicSpeakQuestion.get(body.question_id)
    if not doc or doc.user_id != user_id:
        raise HTTPException(404, "Soru bulunamadı")
    return await _evaluate_and_save(doc, body.transcript.strip())


async def _evaluate_and_save(doc: TopicSpeakQuestion, transcript: str) -> dict:
    try:
        evaluation = await ai_post(
            "/generate/evaluate-spoken-answer",
            {
                "level": doc.level,
                "question": doc.question,
                "topic": doc.topic,
                "transcript": transcript,
                "target_words": doc.target_words or [],
                "target_patterns": doc.target_patterns or [],
            },
        )
    except Exception as e:
        raise HTTPException(502, f"Değerlendirme hatası: {e}") from e

    doc.transcript = transcript
    doc.evaluation = evaluation
    doc.status = "answered"
    doc.answered_at = datetime.utcnow()
    await doc.save()
    return _serialize(doc)


@router.get("/history")
async def history(
    level: str | None = None,
    days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=30, ge=1, le=100),
):
    user_id = settings.default_user_id
    q = TopicSpeakQuestion.find(TopicSpeakQuestion.user_id == user_id)
    if level:
        q = TopicSpeakQuestion.find(
            TopicSpeakQuestion.user_id == user_id,
            TopicSpeakQuestion.level == level.strip().upper(),
        )
    items = await q.sort(-TopicSpeakQuestion.asked_at).limit(limit * 2).to_list()

    if days:
        from datetime import timedelta

        cutoff = datetime.utcnow() - timedelta(days=days)
        items = [i for i in items if i.asked_at and i.asked_at >= cutoff]

    return {"items": [_serialize(i) for i in items[:limit]]}


@router.get("/check-similar")
async def check_similar(
    question: str = Query(..., min_length=3),
    level: str | None = None,
    days: int | None = Query(default=None, ge=1, le=365),
):
    """Debug / research: was this question (or a near duplicate) asked before?"""
    user_id = settings.default_user_id
    since = None
    if days:
        from datetime import timedelta

        since = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        question_store.ensure_collection()
        vec = await embed_query(question)
        hits = await question_store.find_similar(
            vec, user_id=user_id, level=level, limit=15, since=since
        )
        is_dup, info = await _check_duplicate(question, hits)
    except Exception as e:
        raise HTTPException(503, f"Qdrant/embed hatası: {e}") from e

    return {
        "is_duplicate": is_dup,
        "near_match": info,
        "candidates": hits[:10],
    }


@router.get("/topics")
async def list_topics():
    return {"items": TOPIC_POOL}
