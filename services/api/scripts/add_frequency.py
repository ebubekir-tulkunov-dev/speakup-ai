"""Bake usage-frequency data into the Oxford 3000 seed file.

For every word we compute a Zipf frequency (via the `wordfreq` corpus) and
store it as `freq_zipf` on each entry. Higher = more common in real usage.
This lets the learning queue introduce the most useful words first instead
of an alphabetical/random order (which surfaced pairs like
"absolute"/"absolutely" back to back).

Run once after regenerating the seed:

    cd services/api
    source .venv/bin/activate
    PYTHONPATH=. python scripts/add_frequency.py
"""

import json
from pathlib import Path

from wordfreq import zipf_frequency

SEED_PATH = Path(__file__).parent.parent / "seed" / "oxford3000_tr.json"


def score(lemma: str) -> float:
    """Return a Zipf frequency for a single word or a multi-word phrase."""
    lemma = lemma.strip().lower()
    if not lemma:
        return 0.0

    direct = zipf_frequency(lemma, "en")
    if direct > 0:
        return round(direct, 2)

    # Unknown as a whole (rare multi-word/phrasal entry): approximate with the
    # rarest component token, since a phrase is at most as common as that word.
    tokens = [t for t in lemma.replace("-", " ").split() if t.isalpha()]
    if not tokens:
        return 0.0
    return round(min(zipf_frequency(t, "en") for t in tokens), 2)


def main() -> None:
    with open(SEED_PATH, encoding="utf-8") as f:
        words = json.load(f)

    for w in words:
        w["freq_zipf"] = score(w["lemma"])

    # Sort the file itself by descending frequency so the raw data is already
    # ordered most-useful-first (nice for inspection; the queue re-sorts anyway).
    words.sort(key=lambda w: (-w["freq_zipf"], w["lemma"]))

    with open(SEED_PATH, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)

    scored = sum(1 for w in words if w["freq_zipf"] > 0)
    print(f"Scored {scored}/{len(words)} words with frequency data.")
    print("Most frequent:", ", ".join(w["lemma"] for w in words[:10]))
    print("Least frequent:", ", ".join(w["lemma"] for w in words[-10:]))


if __name__ == "__main__":
    main()
