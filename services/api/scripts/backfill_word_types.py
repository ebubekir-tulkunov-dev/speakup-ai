"""Backfill word_type onto Oxford 3000 seed + MongoDB from the source CSV POS column.

Run:
    cd services/api
    source .venv/bin/activate
    PYTHONPATH=. python scripts/backfill_word_types.py
"""

from __future__ import annotations

import asyncio
import csv
import json
import ssl
import urllib.request
from pathlib import Path

ssl._create_default_https_context = ssl._create_unverified_context

SEED_PATH = Path(__file__).parent.parent / "seed" / "oxford3000_tr.json"
CSV_URL = (
    "https://raw.githubusercontent.com/ciwga/Oxford3000_Vocab/main/"
    "oxford3000_vocabulary_with_collocations_and_definitions_datasets.csv"
)

POS_MAP = {
    "noun": "noun",
    "n": "noun",
    "verb": "verb",
    "v": "verb",
    "adjective": "adjective",
    "adj": "adjective",
    "adverb": "adverb",
    "adv": "adverb",
    "preposition": "preposition",
    "prep": "preposition",
    "conjunction": "conjunction",
    "conj": "conjunction",
    "pronoun": "noun",
    "determiner": "noun",
    "exclamation": "noun",
    "number": "noun",
    "modal": "verb",
    "auxiliary": "verb",
}


def normalize_pos(raw: str) -> str:
    raw = (raw or "").strip().lower()
    if not raw:
        return "noun"
    # CSV sometimes has "verb, noun" — take the first
    first = raw.split(",")[0].strip().split("/")[0].strip()
    if "phrasal" in first:
        return "phrasal_verb"
    return POS_MAP.get(first, "noun")


def load_pos_map() -> dict[str, str]:
    print(f"Downloading POS CSV: {CSV_URL}")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response:
        lines = [line.decode("utf-8") for line in response.readlines()]

    reader = csv.reader(lines)
    header = next(reader)
    print("CSV header:", header)

    # Expected: Word, Definition, Turkish Translation, Example Sentence, Part of Speech, ...
    pos_idx = next((i for i, h in enumerate(header) if "part of speech" in h.lower() or h.lower() == "pos"), 4)
    word_idx = 0

    mapping: dict[str, str] = {}
    for row in reader:
        if not row or len(row) <= max(word_idx, pos_idx):
            continue
        lemma = row[word_idx].strip().lower()
        if not lemma:
            continue
        # Multi-word verbs like "give up" → phrasal_verb if POS is verb
        wt = normalize_pos(row[pos_idx])
        if " " in lemma and wt == "verb":
            wt = "phrasal_verb"
        # Keep first seen POS (CSV may have duplicates)
        mapping.setdefault(lemma, wt)
    print(f"Loaded POS for {len(mapping)} lemmas")
    return mapping


def update_seed(pos_map: dict[str, str]) -> dict[str, int]:
    with open(SEED_PATH, encoding="utf-8") as f:
        words = json.load(f)

    counts: dict[str, int] = {}
    for w in words:
        lemma = w["lemma"].strip().lower()
        wt = pos_map.get(lemma, w.get("word_type", "noun"))
        w["word_type"] = wt
        counts[wt] = counts.get(wt, 0) + 1

    with open(SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)

    print(f"Updated seed file: {SEED_PATH}")
    print("Seed distribution:", counts)
    return counts


async def update_db(pos_map: dict[str, str]) -> None:
    from beanie import init_beanie
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.config import settings
    from app.models import ALL_MODELS, Word

    client = AsyncIOMotorClient(settings.mongodb_url)
    await init_beanie(database=client.get_default_database(), document_models=ALL_MODELS)

    updated = 0
    words = await Word.find(Word.source == "oxford3000").to_list()
    for w in words:
        lemma = w.lemma.strip().lower()
        wt = pos_map.get(lemma)
        if not wt:
            continue
        if getattr(w, "word_type", "noun") != wt:
            w.word_type = wt
            await w.save()
            updated += 1

    # Also fix any remaining seed words still stuck as noun when POS known
    print(f"DB: updated word_type on {updated} oxford words")
    for wt in ("verb", "adjective", "adverb", "noun", "phrasal_verb"):
        n = await Word.find(Word.word_type == wt).count()
        print(f"  {wt}: {n}")


def main() -> None:
    pos_map = load_pos_map()
    update_seed(pos_map)
    asyncio.run(update_db(pos_map))


if __name__ == "__main__":
    main()
