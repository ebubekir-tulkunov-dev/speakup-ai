from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.content_gen import generate_and_save_vocab
from app.services.srs import get_vocab_queue, review_word

router = APIRouter(prefix="/vocab", tags=["vocab"])


class ReviewBody(BaseModel):
    quality: str  # again | hard | good | easy
    is_correct: bool | None = None
    user_answer: str | None = None
    card_type: str | None = None


class GenerateVocabBody(BaseModel):
    level: str = "B1"
    topic: str = "English tenses, phrasal verbs, and academic vocabulary"
    count: int = Field(default=15, ge=5, le=50)
    word_type: str | None = None  # noun, verb, adjective, adverb, phrasal_verb


class AddSingleWordBody(BaseModel):
    lemma: str
    translation_tr: str
    word_type: str = "noun"
    level: str = "B1"
    example: str | None = None
    synonyms: list[str] = Field(default_factory=list)
    source: str = "chat"


@router.get("/queue")
async def vocab_queue(
    limit: int = 20,
    level: str | None = None,
    levels: str | None = None,
    word_type: str | None = None,
):
    # Accept either ?level=B1 or ?levels=B1,B2 (multi-select)
    level_list = [p.strip() for p in levels.split(",") if p.strip()] if levels else None
    return {
        "items": await get_vocab_queue(
            limit=limit,
            level=level,
            levels=level_list,
            word_type=word_type,
        )
    }


@router.get("/top")
async def top_words(limit: int = 100, level: str | None = None, exclude_basics: bool = True):
    """Most frequently used words, ordered by usage frequency (for the 'Top 100' page)."""
    from app.models import Word
    from app.services.basic_words import is_basic_lemma

    query = Word.find()
    if level and level != "ALL":
        query = Word.find(Word.level == level)

    # Pull a bit extra so basic-word filtering still yields `limit` items
    fetch_n = limit * 3 if exclude_basics else limit
    words = await query.sort("-freq_zipf").limit(fetch_n).to_list()

    items = []
    for w in words:
        if exclude_basics and is_basic_lemma(w.lemma):
            continue
        items.append({
            "word_id": str(w.id),
            "lemma": w.lemma,
            "translation_tr": w.translation_tr,
            "level": w.level,
            "word_type": getattr(w, "word_type", "noun"),
            "freq_zipf": getattr(w, "freq_zipf", 0.0),
        })
        if len(items) >= limit:
            break
    return {"items": items}


class CaptureWordBody(BaseModel):
    lemma: str
    context: str = ""


@router.post("/capture")
async def capture_word(body: CaptureWordBody):
    """Quickly capture a word heard/read anywhere: AI enriches it, then add to SRS."""
    from app.models import Word, TranslationCache
    from app.services.ai_client import ai_post

    lemma = body.lemma.strip().lower()
    if not lemma:
        raise HTTPException(400, "Kelime boş olamaz")

    existing = await Word.find_one(Word.lemma == lemma)
    if existing:
        return {
            "added": False,
            "word_id": str(existing.id),
            "lemma": existing.lemma,
            "translation_tr": existing.translation_tr,
            "message": "Bu kelime zaten mevcut",
        }

    try:
        enriched = await ai_post("/generate/enrich-word", {"lemma": lemma, "context": body.context})
    except Exception as e:
        raise HTTPException(502, f"AI kelime zenginleştirme başarısız: {e}") from e

    enriched_lemma = (enriched.get("lemma") or lemma).strip().lower()
    translation_tr = enriched.get("translation_tr", "").strip()
    if not translation_tr:
        raise HTTPException(502, "AI çeviri üretemedi")

    # Compute usage frequency if wordfreq is available (baked otherwise = 0.0)
    freq_zipf = 0.0
    try:
        from wordfreq import zipf_frequency
        freq_zipf = round(zipf_frequency(enriched_lemma, "en"), 2)
    except Exception:
        pass

    # A different lemma may already exist (AI normalized the form)
    existing2 = await Word.find_one(Word.lemma == enriched_lemma)
    if existing2:
        return {
            "added": False,
            "word_id": str(existing2.id),
            "lemma": existing2.lemma,
            "translation_tr": existing2.translation_tr,
            "message": "Bu kelime zaten mevcut",
        }

    word = Word(
        lemma=enriched_lemma,
        translation_tr=translation_tr,
        example=enriched.get("example"),
        level=enriched.get("level", "B1"),
        word_type=enriched.get("word_type", "noun"),
        source="capture",
        freq_zipf=freq_zipf,
    )
    await word.insert()

    cache = await TranslationCache.find_one(TranslationCache.lemma == enriched_lemma)
    if not cache:
        await TranslationCache(lemma=enriched_lemma, translation_tr=translation_tr).insert()

    return {
        "added": True,
        "word_id": str(word.id),
        "lemma": word.lemma,
        "translation_tr": word.translation_tr,
        "example": word.example,
        "level": word.level,
        "word_type": word.word_type,
    }


@router.post("/generate")
async def generate_vocab(body: GenerateVocabBody):
    try:
        result = await generate_and_save_vocab(body.level, body.topic, body.count, body.word_type)
        return result
    except Exception as e:
        raise HTTPException(502, f"AI kelime üretimi başarısız: {e}") from e


@router.post("/review/{word_id}")
async def vocab_review(word_id: str, body: ReviewBody):
    if body.quality not in {"again", "hard", "good", "easy"}:
        raise HTTPException(400, "Invalid quality")
    return await review_word(
        word_id=word_id,
        quality_label=body.quality,
        is_correct=body.is_correct,
        user_answer=body.user_answer,
        card_type=body.card_type,
    )


@router.post("/add-single")
async def add_single_word(body: AddSingleWordBody):
    """Add a single word from chat or manual entry."""
    from app.models import Word, TranslationCache

    lemma = body.lemma.strip().lower()
    existing = await Word.find_one(Word.lemma == lemma)
    if existing:
        return {"added": False, "word_id": str(existing.id), "message": "Bu kelime zaten mevcut"}

    word = Word(
        lemma=lemma,
        translation_tr=body.translation_tr,
        example=body.example,
        level=body.level,
        word_type=body.word_type,
        synonyms=body.synonyms,
        source=body.source,
    )
    await word.insert()

    cache = await TranslationCache.find_one(TranslationCache.lemma == lemma)
    if not cache:
        await TranslationCache(lemma=lemma, translation_tr=body.translation_tr).insert()

    return {"added": True, "word_id": str(word.id)}


@router.get("/translate_example/{word_id}")
async def translate_vocab_example(word_id: str):
    from app.services.srs import get_translated_example
    try:
        example_tr = await get_translated_example(word_id)
        return {"example_tr": example_tr}
    except Exception as e:
        raise HTTPException(502, f"Örnek cümle çeviri hatası: {e}")


class CheckSentenceBody(BaseModel):
    word_id: str
    sentence: str


@router.get("/learned")
async def get_learned_words():
    from app.models import KnownWord, UserWord, Word
    from app.config import settings

    user_id = settings.default_user_id

    # 1. Fetch KnownWord documents
    known_docs = await KnownWord.find(KnownWord.user_id == user_id).to_list()
    # 2. Fetch UserWord documents
    user_docs = await UserWord.find(UserWord.user_id == user_id).to_list()

    # Collect unique word IDs
    word_ids = set()
    # Also collect lemmas from KnownWord since KnownWord stores lemma directly
    known_lemmas = set()

    for kd in known_docs:
        if kd.word_id:
            word_ids.add(kd.word_id)
        if kd.lemma:
            known_lemmas.add(kd.lemma.strip().lower())

    for ud in user_docs:
        if ud.word_id:
            word_ids.add(ud.word_id)

    # Fetch Word documents from word_ids
    words = []
    if word_ids:
        words = await Word.find({"_id": {"$in": list(word_ids)}}).to_list()

    # Also, resolve any KnownWord lemmas not matched by ID
    existing_lemmas = {w.lemma.strip().lower() for w in words}
    missing_lemmas = known_lemmas - existing_lemmas

    if missing_lemmas:
        extra_words = await Word.find({"lemma": {"$in": list(missing_lemmas)}}).to_list()
        words.extend(extra_words)

    # Format the items
    items = []
    seen_ids = set()
    for w in words:
        wid = str(w.id)
        if wid in seen_ids:
            continue
        seen_ids.add(wid)
        items.append({
            "word_id": wid,
            "lemma": w.lemma,
            "translation_tr": w.translation_tr,
            "word_type": w.word_type,
            "level": w.level,
            "example": w.example,
        })

    # Sort alphabetically by lemma
    items.sort(key=lambda x: x["lemma"])
    return {"items": items}


@router.post("/check-sentence")
async def check_sentence(body: CheckSentenceBody):
    from app.models import Word, User
    from app.config import settings
    import httpx

    # Fetch word to get the lemma
    word = await Word.get(body.word_id)
    if not word:
        raise HTTPException(404, "Word not found")

    level = word.level or "B1"

    # Call AI service on port 8001
    ai_url = f"{settings.ai_service_url}/generate/evaluate-sentence"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                ai_url,
                json={
                    "word": word.lemma,
                    "sentence": body.sentence,
                    "level": level
                }
            )
            if res.status_code != 200:
                raise HTTPException(502, f"AI service returned error: {res.text}")
            return res.json()
    except httpx.RequestError as e:
        raise HTTPException(503, f"AI service connection failed: {e}")


class ScenarioUpdateBody(BaseModel):
    word_ids: list[str]
    used_correctly: list[bool]


@router.post("/scenario-update")
async def scenario_vocab_update(body: ScenarioUpdateBody):
    """Update vocabulary mastery based on scenario coaching results.

    Words used correctly in a scenario get a mastery boost. Words not used
    or used incorrectly are not penalized (they just don't improve).
    """
    from app.models import UserWord, Word
    from beanie import PydanticObjectId
    from datetime import datetime, timedelta

    user_id = settings.default_user_id
    updated = 0

    for word_id, correct in zip(body.word_ids, body.used_correctly):
        if not correct:
            continue

        oid = PydanticObjectId(word_id)
        word = await Word.get(oid)
        if not word:
            continue

        uw = await UserWord.find_one(
            UserWord.user_id == user_id,
            UserWord.word_id == oid,
        )
        if not uw:
            # Create a new UserWord record for this word
            uw = UserWord(
                user_id=user_id,
                word_id=oid,
                ease_factor=2.5,
                interval=1,
                repetitions=1,
                mastery=1,
                next_review_at=datetime.utcnow() + timedelta(days=1),
            )
        else:
            # Boost mastery by 1 (cap at 5) for correct usage in context
            uw.mastery = min(5, uw.mastery + 1)
            uw.repetitions += 1

        await uw.save()
        updated += 1

    return {"updated": updated, "total": len(body.word_ids)}

