from app.models import Exercise, ReadingPassage, Tense, TranslationCache, Word, Scenario
from app.services.ai_client import ai_post


async def persist_vocab_words(words: list[dict]) -> int:
    added = 0
    for w in words:
        lemma = w.get("lemma", "").strip().lower()
        if not lemma:
            continue
        existing = await Word.find_one(Word.lemma == lemma)
        if existing:
            # Update existing word with new fields if they were empty
            updated = False
            if not existing.word_type or existing.word_type == "noun":
                wt = w.get("word_type")
                if wt:
                    existing.word_type = wt
                    updated = True
            if not existing.synonyms and w.get("synonyms"):
                existing.synonyms = w["synonyms"]
                updated = True
            if not existing.antonyms and w.get("antonyms"):
                existing.antonyms = w["antonyms"]
                updated = True
            if not existing.collocations and w.get("collocations"):
                existing.collocations = w["collocations"]
                updated = True
            if not existing.forms and w.get("forms"):
                existing.forms = w["forms"]
                updated = True
            if updated:
                await existing.save()
            continue
        word = Word(
            lemma=lemma,
            translation_tr=w.get("translation_tr", ""),
            example=w.get("example"),
            level=w.get("level", "B1"),
            topic=w.get("topic"),
            source="ai",
            word_type=w.get("word_type", "noun"),
            synonyms=w.get("synonyms", []),
            antonyms=w.get("antonyms", []),
            collocations=w.get("collocations", []),
            forms=w.get("forms", {}),
        )
        await word.insert()
        cache = await TranslationCache.find_one(TranslationCache.lemma == lemma)
        if not cache:
            await TranslationCache(lemma=lemma, translation_tr=word.translation_tr).insert()
        added += 1
    return added


async def persist_tense_content(tense: Tense, content: dict) -> dict:
    tense.ai_lesson = {
        "lesson_tr": content.get("lesson_tr", ""),
        "tips_tr": content.get("tips_tr", []),
        "common_mistakes": content.get("common_mistakes", []),
    }
    await tense.save()

    exercises_added = []
    for ex in content.get("exercises", []):
        prompt = ex.get("prompt", "").strip()
        if not prompt:
            continue
            
        # Check if an exercise with this prompt already exists for this tense
        existing = await Exercise.find_one(
            Exercise.tense_id == tense.id,
            Exercise.prompt == prompt
        )
        if existing:
            continue

        ex_type = ex.get("type", "fill_blank")
        if ex_type not in {"fill_blank", "transform", "choose_tense", "error_correction"}:
            ex_type = "fill_blank"
        exercise = Exercise(
            type=ex_type,
            category="tenses",
            tense_id=tense.id,
            prompt=prompt,
            answer=ex.get("answer", ""),
            options=ex.get("options") or [],
            hint_tr=ex.get("hint_tr"),
            source="ai",
        )
        await exercise.insert()
        exercises_added.append(str(exercise.id))

    return {"exercises_added": len(exercises_added), "exercise_ids": exercises_added}


async def persist_reading_passage(data: dict) -> ReadingPassage:
    content = data.get("content", "")
    passage = ReadingPassage(
        title=data.get("title", "AI Metin"),
        content=content,
        level=data.get("level", "B1"),
        word_count=len(content.split()),
        tense_focus=data.get("tense_focus"),
        summary_tr=data.get("summary_tr"),
        source="ai",
    )
    await passage.insert()
    return passage


async def generate_and_save_vocab(level: str, topic: str, count: int, word_type: str | None = None) -> dict:
    existing = await Word.find_all().limit(300).to_list()
    exclude = [w.lemma for w in existing]
    payload = {
        "level": level,
        "topic": topic,
        "count": count,
        "exclude": exclude,
    }
    if word_type:
        payload["word_type"] = word_type
    result = await ai_post("/generate/vocab", payload)
    added = await persist_vocab_words(result.get("words", []))
    return {"added": added, "requested": count}


async def generate_and_save_tense_lesson(tense: Tense, exercise_count: int = 5) -> dict:
    # Fetch existing exercises for this tense to exclude their prompts from AI generation
    existing_exercises = await Exercise.find(Exercise.tense_id == tense.id).to_list()
    exclude_prompts = [e.prompt for e in existing_exercises]

    content = await ai_post("/generate/tense", {
        "tense_name_en": tense.name_en,
        "tense_name_tr": tense.name_tr,
        "formula": tense.formula,
        "exercise_count": exercise_count,
        "exclude_prompts": exclude_prompts[-30:],  # Exclude last 30 to stay within limits
    })
    meta = await persist_tense_content(tense, content)
    return {"ai_lesson": tense.ai_lesson, **meta}


async def generate_and_save_reading(level: str, topic: str, tense_focus: str, word_count: int) -> dict:
    data = await ai_post("/generate/reading", {
        "level": level,
        "topic": topic,
        "tense_focus": tense_focus,
        "word_count": word_count,
    })
    passage = await persist_reading_passage(data)
    return {
        "id": str(passage.id),
        "title": passage.title,
        "level": passage.level,
        "word_count": passage.word_count,
    }


async def generate_and_save_scenario(level: str, topic: str, target_tense_slug: str | None) -> dict:
    data = await ai_post("/generate/scenario", {
        "level": level,
        "topic": topic,
        "target_tense_slug": target_tense_slug,
    })
    scenario = Scenario(
        title=data.get("title", "AI Senaryo"),
        context=data.get("context", ""),
        difficulty=level,
        target_tense_slug=target_tense_slug,
        opening_line=data.get("opening_line", "Hello!"),
        category=data.get("category", "general"),
    )
    await scenario.insert()
    return {
        "id": str(scenario.id),
        "title": scenario.title,
        "difficulty": scenario.difficulty,
    }
