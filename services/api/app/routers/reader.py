from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.models import KnownWord, ReadingPassage, TranslationCache, UserAttempt, Word
from app.services.ai_client import ai_post
from app.services.content_gen import generate_and_save_reading

router = APIRouter(prefix="/reader", tags=["reader"])


class MarkWordBody(BaseModel):
    lemma: str
    mastery: int = 1
    word_id: str | None = None


class GenerateReadingBody(BaseModel):
    level: str = "B1"
    topic: str = "daily life"
    tense_focus: str = "mixed tenses"
    word_count: int = Field(default=120, ge=80, le=250)


@router.get("/passages")
async def list_passages():
    passages = await ReadingPassage.find_all().sort(-ReadingPassage.id).to_list()
    return {
        "items": [
            {
                "id": str(p.id),
                "title": p.title,
                "level": p.level,
                "word_count": p.word_count,
                "source": p.source,
                "tense_focus": p.tense_focus,
                "preview": p.content[:120] + "..." if len(p.content) > 120 else p.content,
            }
            for p in passages
        ]
    }


@router.post("/generate")
async def generate_passage(body: GenerateReadingBody):
    try:
        return await generate_and_save_reading(
            body.level, body.topic, body.tense_focus, body.word_count
        )
    except Exception as e:
        raise HTTPException(502, f"AI metin üretimi başarısız: {e}") from e


@router.get("/passages/{passage_id}")
async def get_passage(passage_id: str):
    passage = await ReadingPassage.get(passage_id)
    if not passage:
        raise HTTPException(404, "Passage not found")

    known = await KnownWord.find(KnownWord.user_id == settings.default_user_id).to_list()
    known_map = {k.lemma.lower(): k.mastery for k in known}

    return {
        "id": str(passage.id),
        "title": passage.title,
        "content": passage.content,
        "level": passage.level,
        "known_words": known_map,
    }


@router.get("/translate")
async def translate_word(word: str):
    lemma = word.strip().lower()
    if not lemma:
        raise HTTPException(400, "Word required")

    cached = await TranslationCache.find_one(TranslationCache.lemma == lemma)
    if cached:
        return {"lemma": lemma, "translation_tr": cached.translation_tr, "source": "cache"}

    db_word = await Word.find_one(Word.lemma == lemma)
    if db_word:
        return {"lemma": lemma, "translation_tr": db_word.translation_tr, "source": "words"}

    return {"lemma": lemma, "translation_tr": None, "source": "missing"}


@router.post("/passages/{passage_id}/quiz")
async def passage_quiz(passage_id: str, regenerate: bool = False):
    """Return (and cache) AI comprehension questions for a passage."""
    passage = await ReadingPassage.get(passage_id)
    if not passage:
        raise HTTPException(404, "Passage not found")

    if passage.questions and not regenerate:
        return {"questions": passage.questions}

    try:
        result = await ai_post(
            "/generate/reading-questions",
            {"content": passage.content, "level": passage.level, "count": 4},
        )
    except Exception as e:
        raise HTTPException(502, f"Soru üretimi başarısız: {e}") from e

    questions = result.get("questions", [])
    passage.questions = questions
    await passage.save()
    return {"questions": questions}


class QuizSubmitBody(BaseModel):
    correct_count: int = 0
    total: int = 0


@router.post("/passages/{passage_id}/quiz/submit")
async def submit_quiz(passage_id: str, body: QuizSubmitBody):
    """Log quiz results so they count toward the dashboard streak / daily goal."""
    passed = body.total > 0 and body.correct_count >= (body.total / 2)
    await UserAttempt(
        user_id=settings.default_user_id,
        source_type="reading_quiz",
        source_id=passage_id,
        answer=f"{body.correct_count}/{body.total}",
        is_correct=passed,
    ).insert()
    return {"correct_count": body.correct_count, "total": body.total, "passed": passed}


@router.post("/words/mark")
async def mark_word(body: MarkWordBody):
    existing = await KnownWord.find_one(
        KnownWord.user_id == settings.default_user_id,
        KnownWord.lemma == body.lemma.lower(),
    )
    if existing:
        existing.mastery = body.mastery
        existing.marked_at = datetime.utcnow()
        await existing.save()
        return {"lemma": body.lemma, "mastery": existing.mastery}

    item = KnownWord(
        user_id=settings.default_user_id,
        lemma=body.lemma.lower(),
        mastery=body.mastery,
        word_id=body.word_id,
    )
    await item.insert()
    return {"lemma": body.lemma, "mastery": body.mastery}
