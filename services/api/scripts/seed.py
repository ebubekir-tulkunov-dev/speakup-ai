import asyncio
import json
from pathlib import Path

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.models import (
    ALL_MODELS,
    Exercise,
    ReadingPassage,
    Scenario,
    Tense,
    TranslationCache,
    User,
    Word,
)

SEED_DIR = Path(__file__).parent.parent / "seed"


def load_json(name: str):
    with open(SEED_DIR / name, encoding="utf-8") as f:
        return json.load(f)


async def seed():
    client = AsyncIOMotorClient(settings.mongodb_url)
    await init_beanie(database=client.get_default_database(), document_models=ALL_MODELS)

    if not await User.find_one(User.user_id == settings.default_user_id):
        await User(user_id=settings.default_user_id).insert()

    if await Tense.count() == 0:
        tense_map: dict[str, Tense] = {}
        for item in load_json("tenses.json"):
            tense = Tense(**item)
            await tense.insert()
            tense_map[item["slug"]] = tense
        print(f"Seeded {len(tense_map)} tenses")

        exercises_data = load_json("exercises.json")
        for ex in exercises_data:
            tense_slug = ex.pop("tense_slug", None)
            tense_id = tense_map[tense_slug].id if tense_slug and tense_slug in tense_map else None
            await Exercise(tense_id=tense_id, **ex).insert()
        print(f"Seeded {len(exercises_data)} exercises")

    if await Word.count() == 0:
        words = load_json("words.json")
        for w in words:
            await Word(**w).insert()
            await TranslationCache(lemma=w["lemma"], translation_tr=w["translation_tr"]).insert()
        print(f"Seeded {len(words)} basic words")

    # Load and seed/update Oxford 3000 words
    try:
        oxford_words = load_json("oxford3000_tr.json")
        oxford_added = 0
        freq_backfilled = 0
        for w in oxford_words:
            lemma = w["lemma"].strip().lower()
            freq_zipf = float(w.get("freq_zipf", 0.0))
            existing = await Word.find_one(Word.lemma == lemma)
            if not existing:
                await Word(
                    lemma=lemma,
                    translation_tr=w["translation_tr"],
                    example=w["example"],
                    level=w["level"],
                    source="oxford3000",
                    freq_zipf=freq_zipf,
                    word_type=w.get("word_type", "noun"),
                ).insert()
                
                cache_existing = await TranslationCache.find_one(TranslationCache.lemma == lemma)
                if not cache_existing:
                    await TranslationCache(lemma=lemma, translation_tr=w["translation_tr"]).insert()
                oxford_added += 1
            else:
                changed = False
                if existing.source == "seed" or existing.level != w["level"]:
                    existing.level = w["level"]
                    existing.source = "oxford3000"
                    changed = True
                # Backfill frequency onto words seeded before this field existed
                if freq_zipf > 0 and getattr(existing, "freq_zipf", 0.0) != freq_zipf:
                    existing.freq_zipf = freq_zipf
                    changed = True
                    freq_backfilled += 1
                seed_wt = w.get("word_type")
                if seed_wt and getattr(existing, "word_type", "noun") != seed_wt:
                    existing.word_type = seed_wt
                    changed = True
                if changed:
                    await existing.save()
        print(f"Seeded/Updated {oxford_added} new Oxford 3000 words ({freq_backfilled} frequency backfills)")
    except Exception as e:
        print(f"Oxford 3000 seeding skipped or failed: {e}")

    scenarios = load_json("scenarios.json")
    synced = 0
    for s in scenarios:
        existing = await Scenario.find_one(Scenario.opening_line == s["opening_line"])
        if existing:
            for key, value in s.items():
                setattr(existing, key, value)
            await existing.save()
            synced += 1
        else:
            await Scenario(**s).insert()
            synced += 1
    print(f"Synced {synced} scenarios")

    if await ReadingPassage.count() == 0:
        passages = load_json("passages.json")
        for p in passages:
            p["word_count"] = len(p["content"].split())
            await ReadingPassage(**p).insert()
        print(f"Seeded {len(passages)} passages")

    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
