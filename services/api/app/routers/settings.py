from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models import Scenario, User

router = APIRouter(prefix="/settings", tags=["settings"])


SUPPORTED_NATIVE_LANGS = frozenset({"tr", "en", "de", "es", "fr", "ar", "ru", "zh", "ja", "ko", "pt", "it", "nl", "pl", "uk"})


class SettingsUpdate(BaseModel):
    daily_goal: int | None = None
    tts_provider: str | None = None
    native_lang: str | None = None


@router.get("")
async def get_settings():
    user = await User.find_one(User.user_id == settings.default_user_id)
    return {
        "native_lang": user.native_lang if user else "tr",
        "target_lang": user.target_lang if user else "en",
        "daily_goal": user.daily_goal if user else 20,
        "settings": user.settings if user else {},
    }


@router.patch("")
async def update_settings(body: SettingsUpdate):
    user = await User.find_one(User.user_id == settings.default_user_id)
    if not user:
        user = User(user_id=settings.default_user_id)
        await user.insert()

    if body.daily_goal is not None:
        user.daily_goal = body.daily_goal
    if body.tts_provider is not None:
        user.settings["tts_provider"] = body.tts_provider
    if body.native_lang is not None:
        if body.native_lang not in SUPPORTED_NATIVE_LANGS:
            raise HTTPException(400, f"Unsupported native language: {body.native_lang}")
        user.native_lang = body.native_lang

    await user.save()
    return {
        "native_lang": user.native_lang,
        "target_lang": user.target_lang,
        "daily_goal": user.daily_goal,
        "settings": user.settings,
    }


@router.get("/scenarios")
async def list_scenarios():
    scenarios = await Scenario.find_all().to_list()
    return {
        "items": [
            {
                "id": str(s.id),
                "title": s.title,
                "context": s.context,
                "difficulty": s.difficulty,
                "target_tense_slug": s.target_tense_slug,
                "opening_line": s.opening_line,
                "category": s.category,
            }
            for s in scenarios
        ]
    }


class GenerateScenarioBody(BaseModel):
    level: str = "B1"
    topic: str = "daily life"
    target_tense_slug: str | None = None


@router.post("/scenarios/generate")
async def generate_scenario_endpoint(body: GenerateScenarioBody):
    try:
        from app.services.content_gen import generate_and_save_scenario
        return await generate_and_save_scenario(
            body.level, body.topic, body.target_tense_slug
        )
    except Exception as e:
        raise HTTPException(502, f"AI senaryo üretimi başarısız: {e}") from e


# ── Coaching Scenario Templates ──────────────────────────────────────

import json
from pathlib import Path

_COACHING_TEMPLATES_CACHE: list[dict] | None = None


def _load_coaching_templates() -> list[dict]:
    global _COACHING_TEMPLATES_CACHE
    if _COACHING_TEMPLATES_CACHE is not None:
        return _COACHING_TEMPLATES_CACHE

    seed_path = Path(__file__).resolve().parents[2] / "seed" / "scenario_coaching_templates.json"
    if not seed_path.exists():
        return []
    with open(seed_path, "r", encoding="utf-8") as f:
        _COACHING_TEMPLATES_CACHE = json.load(f)
    return _COACHING_TEMPLATES_CACHE


@router.get("/scenario-templates")
async def list_scenario_templates():
    """Return all pre-defined coaching scenario templates."""
    templates = _load_coaching_templates()
    return {"items": templates}


class GenerateCoachingBody(BaseModel):
    level: str = "B1"
    target_tense: str = "Past Simple"
    word_pool: list[dict] = []  # [{lemma, tr, type}, ...]


@router.post("/scenarios/generate-coaching")
async def generate_coaching_scenario(body: GenerateCoachingBody):
    """Use AI to generate a coaching scenario description dynamically."""
    from app.services.ai_client import ai_post

    try:
        result = await ai_post("/generate/coaching-scenario", {
            "level": body.level,
            "target_tense": body.target_tense,
            "word_pool": body.word_pool,
        })
        return result
    except Exception as e:
        raise HTTPException(502, f"AI koçluk senaryosu üretimi başarısız: {e}") from e

