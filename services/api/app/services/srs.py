from datetime import datetime, timedelta

from beanie import PydanticObjectId

from app.config import settings
from app.models import ErrorPoolItem, User, UserWord, Word

QUALITY_MAP = {
    "again": 0,
    "hard": 3,
    "good": 4,
    "easy": 5,
}


def sm2_update(
    quality: int,
    ease_factor: float,
    interval: int,
    repetitions: int,
) -> tuple[float, int, int]:
    if quality < 3:
        return ease_factor, 0, 0

    new_ef = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_ef = max(1.3, new_ef)

    if repetitions == 0:
        new_interval = 1
    elif repetitions == 1:
        new_interval = 6
    else:
        new_interval = round(interval * new_ef)

    return new_ef, new_interval, repetitions + 1


def _parse_levels(level: str | None = None, levels: list[str] | None = None) -> set[str] | None:
    """Return selected CEFR levels, or None for no filter (all levels)."""
    collected: list[str] = []
    if levels:
        collected.extend(levels)
    if level:
        collected.extend(part.strip() for part in level.split(",") if part.strip())
    cleaned = {
        lv.upper()
        for lv in collected
        if lv and lv.upper() != "ALL"
    }
    return cleaned or None


def _default_card_type(native_lang: str, target_lang: str) -> str:
    """Show native-language gloss → pick target word (production practice)."""
    if native_lang == target_lang:
        return "target_to_native"
    return "native_to_target"


def _pick_distractors(
    pool: list[Word],
    *,
    lemma: str,
    native_gloss: str,
    word_type: str,
    card_type: str,
    pool_glosses: dict[str, str] | None = None,
    count: int = 3,
) -> list[str]:
    import random

    target_type = word_type or "noun"
    typed = [w for w in pool if getattr(w, "word_type", "noun") == target_type]
    source = typed if len(typed) >= count + 1 else pool
    pool_glosses = pool_glosses or {}

    if card_type == "target_to_native":
        candidates = list({
            pool_glosses.get(str(d.id), d.translation_tr).strip()
            for d in source
            if d.lemma.lower() != lemma.lower()
            and pool_glosses.get(str(d.id), d.translation_tr).strip()
            and pool_glosses.get(str(d.id), d.translation_tr).strip().lower() != native_gloss.strip().lower()
        })
        fallbacks = ["word", "term", "idea"]
    else:
        candidates = list({
            d.lemma.strip()
            for d in source
            if d.lemma.lower() != lemma.lower() and d.lemma.strip()
        })
        fallbacks = ["word", "thing", "place"]

    if len(candidates) >= count:
        return random.sample(candidates, count)
    extra = [f for f in fallbacks if f.lower() != lemma.lower() and f not in candidates]
    return (candidates + extra)[:count]


async def get_vocab_queue(
    limit: int = 20,
    level: str | None = None,
    levels: list[str] | None = None,
    word_type: str | None = None,
    *,
    enrich: bool = True,
    direction: str | None = None,
) -> list[dict]:
    import random

    from app.services.basic_words import is_basic_lemma
    from app.services.native_translation import resolve_native_translations

    user_id = settings.default_user_id
    user = await User.find_one(User.user_id == user_id)
    native_lang = (user.native_lang if user else "tr").lower()
    target_lang = (user.target_lang if user else "en").lower()
    if direction in ("native_to_target", "target_to_native"):
        card_type_default = direction
    else:
        card_type_default = _default_card_type(native_lang, target_lang)
    now = datetime.utcnow()
    level_filter = _parse_levels(level=level, levels=levels)

    def word_card(word: Word, *, user_word_id: str | None = None, mastery: int = 0) -> dict:
        return {
            "user_word_id": user_word_id,
            "word_id": str(word.id),
            "lemma": word.lemma,
            "translation_tr": word.translation_tr,
            "example": word.example,
            "example_tr": getattr(word, "example_tr", None),
            "mastery": mastery,
            "level": word.level,
            "word_type": getattr(word, "word_type", "noun"),
            "synonyms": getattr(word, "synonyms", []),
            "antonyms": getattr(word, "antonyms", []),
            "collocations": getattr(word, "collocations", []),
            "forms": getattr(word, "forms", {}),
        }

    def matches_filters(word: Word) -> bool:
        if is_basic_lemma(word.lemma):
            return False
        if level_filter and word.level not in level_filter:
            return False
        if word_type and getattr(word, "word_type", "noun") != word_type:
            return False
        return True

    due = (
        await UserWord.find(
            UserWord.user_id == user_id,
            UserWord.next_review_at <= now,
        )
        .sort("+next_review_at")
        .to_list()
    )

    due_items: list[dict] = []
    for uw in due:
        word = await Word.get(uw.word_id)
        if not word or not matches_filters(word):
            continue
        due_items.append(word_card(word, user_word_id=str(uw.id), mastery=uw.mastery))

    random.shuffle(due_items)

    existing_ids = {uw.word_id for uw in await UserWord.find(UserWord.user_id == user_id).to_list()}
    if level_filter:
        all_words = await Word.find({"level": {"$in": list(level_filter)}}).to_list()
    else:
        all_words = await Word.find_all().to_list()

    new_words = [w for w in all_words if w.id not in existing_ids and matches_filters(w)]
    # Introduce the most commonly used words first: sort by usage frequency
    # (Zipf scale, higher = more common). Oxford 3000 words come before any
    # AI-generated extras, and frequency is the primary ordering within that.
    new_words.sort(
        key=lambda w: (
            w.source != "oxford3000",
            -getattr(w, "freq_zipf", 0.0),
            w.lemma,
        )
    )

    # Don't let a backlog of due A–D reviews monopolize the queue — always
    # reserve room for unseen words so the alphabet keeps advancing.
    new_slots = min(len(new_words), max(limit // 2, 1) if due_items else limit)
    due_slots = min(len(due_items), limit - new_slots)

    result: list[dict] = []
    result.extend(due_items[:due_slots])
    for word in new_words[:new_slots]:
        result.append(word_card(word))

    # If one side ran short, backfill from the other
    if len(result) < limit:
        used_due = {i["word_id"] for i in result if i.get("user_word_id")}
        for item in due_items[due_slots:]:
            if len(result) >= limit:
                break
            if item["word_id"] not in used_due:
                result.append(item)
    if len(result) < limit:
        used_ids = {i["word_id"] for i in result}
        for word in new_words[new_slots:]:
            if len(result) >= limit:
                break
            if str(word.id) not in used_ids:
                result.append(word_card(word))

    random.shuffle(result)
    result = result[:limit]
    if not enrich:
        return result

    for item in result:
        item["card_type"] = card_type_default
        item["native_lang"] = native_lang
        item["target_lang"] = target_lang

    # Native-language glosses (Settings → Native Language)
    word_objs = []
    for item in result:
        w = await Word.get(item["word_id"])
        if w:
            word_objs.append(w)
    native_map = await resolve_native_translations(word_objs, native_lang)
    for item in result:
        item["native_translation"] = native_map.get(item["word_id"], item["translation_tr"])

    # Build options for multiple choice guessing game
    total_count = await Word.count()
    if total_count > 100:
        skip_val = random.randint(0, total_count - 100)
        distractor_pool = await Word.find().skip(skip_val).limit(100).to_list()
    else:
        distractor_pool = await Word.find().to_list()

    pool_glosses = await resolve_native_translations(distractor_pool, native_lang)

    for item in result:
        lemma = item["lemma"]
        native_gloss = item["native_translation"]
        card_type = item["card_type"]
        word_type = item.get("word_type", "noun")

        if card_type == "target_to_native":
            correct = native_gloss
        else:
            correct = lemma

        chosen_distractors = _pick_distractors(
            distractor_pool,
            lemma=lemma,
            native_gloss=native_gloss,
            word_type=word_type,
            card_type=card_type,
            pool_glosses=pool_glosses,
        )

        options = [correct] + chosen_distractors
        random.shuffle(options)
        item["options"] = options

    return result[:limit]


async def review_word(
    word_id: str,
    quality_label: str,
    is_correct: bool | None = None,
    user_answer: str | None = None,
    card_type: str | None = None,
) -> dict:
    user_id = settings.default_user_id
    quality = QUALITY_MAP.get(quality_label, 3)
    oid = PydanticObjectId(word_id)

    uw = await UserWord.find_one(UserWord.user_id == user_id, UserWord.word_id == oid)
    if not uw:
        uw = UserWord(user_id=user_id, word_id=oid)

    ease, interval, reps = sm2_update(quality, uw.ease_factor, uw.interval, uw.repetitions)
    uw.ease_factor = ease
    uw.interval = interval
    uw.repetitions = reps
    uw.next_review_at = datetime.utcnow() + timedelta(days=max(interval, 1))
    uw.mastery = min(5, uw.mastery + (1 if quality >= 4 else 0))

    if quality < 3:
        uw.mastery = max(0, uw.mastery - 1)

    await uw.save()



    return {
        "word_id": word_id,
        "next_review_at": uw.next_review_at.isoformat(),
        "mastery": uw.mastery,
        "interval": uw.interval,
    }


async def add_to_error_pool(
    source_type: str,
    source_id: str,
    prompt: str,
    correct_answer: str,
    user_answer: str | None = None,
) -> None:
    user_id = settings.default_user_id
    existing = await ErrorPoolItem.find_one(
        ErrorPoolItem.user_id == user_id,
        ErrorPoolItem.source_type == source_type,
        ErrorPoolItem.source_id == source_id,
    )
    if existing:
        existing.wrong_streak += 1
        existing.correct_streak = 0
        existing.priority = 1 + existing.wrong_streak * 2
        existing.user_answer = user_answer
        existing.last_seen_at = datetime.utcnow()
        await existing.save()
        return

    await ErrorPoolItem(
        user_id=user_id,
        source_type=source_type,
        source_id=source_id,
        prompt=prompt,
        correct_answer=correct_answer,
        user_answer=user_answer,
        priority=3,
    ).insert()


async def review_error_item(item_id: str, is_correct: bool) -> dict:
    item = await ErrorPoolItem.get(PydanticObjectId(item_id))
    if not item:
        raise ValueError("Error item not found")

    item.review_count += 1
    item.last_seen_at = datetime.utcnow()

    if is_correct:
        item.correct_streak += 1
        item.wrong_streak = 0
        item.priority = max(1, item.priority - 1)
        if item.correct_streak >= 2:
            await item.delete()
            return {"removed": True, "id": item_id}
    else:
        item.wrong_streak += 1
        item.correct_streak = 0
        item.priority += 2

    await item.save()
    return {"removed": False, "id": item_id, "priority": item.priority}


async def get_error_queue(limit: int = 20) -> list[dict]:
    user_id = settings.default_user_id
    items = (
        await ErrorPoolItem.find(ErrorPoolItem.user_id == user_id)
        .sort("-priority", "-last_seen_at")
        .limit(limit)
        .to_list()
    )
    return [
        {
            "id": str(i.id),
            "source_type": i.source_type,
            "prompt": i.prompt,
            "correct_answer": i.correct_answer,
            "priority": i.priority,
            "wrong_streak": i.wrong_streak,
        }
        for i in items
    ]


async def get_translated_example(word_id: str) -> str | None:
    from app.services.ai_client import ai_post
    oid = PydanticObjectId(word_id)
    word = await Word.get(oid)
    if not word or not word.example:
        return None

    if getattr(word, "example_tr", None):
        return word.example_tr

    try:
        res = await ai_post("/generate/translate_text", {
            "text": word.example,
            "target_lang": "Turkish"
        })
        translation = res.get("translation", "").strip()
        if translation:
            word.example_tr = translation
            await word.save()
            return translation
    except Exception as e:
        print(f"Failed to translate example sentence: {e}")

    return None
