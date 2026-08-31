import json
import uuid
from datetime import timedelta

from fastapi import APIRouter
from livekit.api import AccessToken, RoomAgentDispatch, RoomConfiguration, VideoGrants
from pydantic import BaseModel, Field

from app.config import settings
from app.models import User, UserWord, Word

router = APIRouter(prefix="/livekit", tags=["livekit"])


async def _vocab_for_voice(limit: int = 20) -> list[dict]:
    """Compact list of words the student has practiced (for voice agent prompts)."""
    user_id = settings.default_user_id
    user_words = await UserWord.find(UserWord.user_id == user_id).to_list()
    if not user_words:
        return []

    # Prefer higher mastery / more repetitions, then fill up to limit
    user_words.sort(key=lambda uw: (uw.mastery, uw.repetitions), reverse=True)
    selected = user_words[: max(limit * 2, limit)]

    words: list[dict] = []
    seen: set[str] = set()
    for uw in selected:
        word = await Word.get(uw.word_id)
        if not word:
            continue
        lemma = (word.lemma or "").strip()
        if not lemma or lemma.lower() in seen:
            continue
        seen.add(lemma.lower())
        words.append({
            "lemma": lemma,
            "tr": word.translation_tr,
            "type": getattr(word, "word_type", "noun"),
        })
        if len(words) >= limit:
            break
    return words


async def _vocab_for_scenario(
    level: str = "B1",
    word_types: list[str] | None = None,
    count: int = 8,
) -> list[dict]:
    """Select Oxford 3000 words for a scenario coaching session.

    Priority:
      1. Unlearned words (no UserWord record or mastery == 0)
      2. Learning words (mastery 1-2, need reinforcement)
      3. Learned words (mastery 3+, filler / context)

    Words are filtered by CEFR level (target level and below) and optionally
    by word_type.  Basic function words (the, a, is, etc.) are excluded.
    """
    from app.services.basic_words import is_basic_lemma

    user_id = settings.default_user_id
    # CEFR ordering for "level and below" filtering
    cefr_order = ["A1", "A2", "B1", "B2", "C1", "C2"]
    try:
        max_idx = cefr_order.index(level.upper())
    except ValueError:
        max_idx = 2  # default to B1
    allowed_levels = set(cefr_order[: max_idx + 1])

    # Fetch candidate words from the database
    word_query: dict = {"level": {"$in": list(allowed_levels)}}
    if word_types:
        word_query["word_type"] = {"$in": word_types}
    all_words = await Word.find(word_query).to_list()

    # Build a word_id -> mastery map from UserWord
    user_words = await UserWord.find(UserWord.user_id == user_id).to_list()
    mastery_map: dict = {str(uw.word_id): uw.mastery for uw in user_words}

    # Classify words by priority
    unlearned: list[Word] = []
    learning: list[Word] = []
    learned: list[Word] = []

    for w in all_words:
        if is_basic_lemma(w.lemma):
            continue
        m = mastery_map.get(str(w.id), -1)  # -1 = no UserWord record at all
        if m <= 0:
            unlearned.append(w)
        elif m <= 2:
            learning.append(w)
        else:
            learned.append(w)

    import random
    random.shuffle(unlearned)
    random.shuffle(learning)
    random.shuffle(learned)

    # Pick from each bucket in priority order
    result: list[dict] = []
    seen: set[str] = set()
    for pool in [unlearned, learning, learned]:
        for w in pool:
            lemma = (w.lemma or "").strip()
            if not lemma or lemma.lower() in seen:
                continue
            seen.add(lemma.lower())
            result.append({
                "word_id": str(w.id),
                "lemma": lemma,
                "tr": w.translation_tr,
                "type": getattr(w, "word_type", "noun"),
                "level": w.level,
                "mastery": mastery_map.get(str(w.id), 0),
            })
            if len(result) >= count:
                break
        if len(result) >= count:
            break

    return result


@router.get("/scenario-words")
async def get_scenario_words(
    level: str = "B1",
    word_types: str | None = None,
    count: int = 8,
):
    """Return prioritized word list for a scenario coaching session."""
    wt_list = [t.strip() for t in word_types.split(",") if t.strip()] if word_types else None
    words = await _vocab_for_scenario(level=level, word_types=wt_list, count=count)
    return {"items": words}


class ScenarioTokenBody(BaseModel):
    level: str = "B1"
    scenario: str = "Serbest sohbet"
    scenario_mode: bool = False
    scenario_config: dict | None = None
    # When True, reply chips are bilingual (English to speak + Turkish meaning)
    suggestions_tr: bool = True
    # "manual" = student presses Send; "auto" = agent ends turn on silence
    turn_mode: str = "manual"


@router.post("/token")
async def create_token(body: ScenarioTokenBody | None = None, room: str | None = None,
                       level: str = "B1", scenario: str = "Serbest sohbet",
                       suggestions_tr: bool = True, turn_mode: str = "manual"):
    # Support both body-based and query-param-based calls
    if body:
        level = body.level
        scenario = body.scenario
        scenario_mode = body.scenario_mode
        scenario_config = body.scenario_config
        suggestions_tr = body.suggestions_tr
        turn_mode = body.turn_mode or "manual"
    else:
        scenario_mode = False
        scenario_config = None

    if turn_mode not in ("manual", "auto"):
        turn_mode = "manual"

    user = await User.find_one(User.user_id == settings.default_user_id)
    tts_provider = "cartesia"
    if user and user.settings:
        tts_provider = user.settings.get("tts_provider", "cartesia")

    # Fresh room each session — reusing the same room after agent exit
    # leaves the client stuck on "connecting" with no new agent job.
    room_name = room if room and room != "dil-programi" else f"dil-{uuid.uuid4().hex[:10]}"

    vocab_words = await _vocab_for_voice(limit=20)

    metadata: dict = {
        "level": level,
        "scenario": scenario,
        "tts_provider": tts_provider,
        "vocab_words": vocab_words,
        "suggestions_tr": suggestions_tr,
        "turn_mode": turn_mode,
    }

    # If scenario coaching mode is active, inject scenario config into metadata
    if scenario_mode and scenario_config:
        metadata["scenario_mode"] = True
        metadata["scenario_config"] = scenario_config

    token = (
        AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(settings.default_user_id)
        .with_name("Öğrenci")
        .with_metadata(json.dumps(metadata, ensure_ascii=False))
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
            )
        )
        # Explicitly request an agent for this room (empty name = default worker)
        .with_room_config(
            RoomConfiguration(
                agents=[RoomAgentDispatch(agent_name="")],
            )
        )
        .with_ttl(timedelta(hours=2))
    )
    return {
        "token": token.to_jwt(),
        "url": settings.livekit_url,
        "room": room_name,
        "vocab_count": len(vocab_words),
    }
