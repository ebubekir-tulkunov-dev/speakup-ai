"""Resolve vocabulary glosses in the user's native language (Settings → Native Language)."""

from app.models import TranslationCache, Word
from app.services.ai_client import ai_post

# Matches settings.SUPPORTED_NATIVE_LANGS
LANG_NAMES: dict[str, str] = {
    "tr": "Turkish",
    "en": "English",
    "de": "German",
    "es": "Spanish",
    "fr": "French",
    "ar": "Arabic",
    "ru": "Russian",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "pt": "Portuguese",
    "it": "Italian",
    "nl": "Dutch",
    "pl": "Polish",
    "uk": "Ukrainian",
}


async def _cache_translation(lemma: str, lang: str, translation: str) -> None:
    lemma = lemma.strip().lower()
    cache = await TranslationCache.find_one(TranslationCache.lemma == lemma)
    if cache:
        translations = dict(cache.translations or {})
        translations[lang] = translation
        cache.translations = translations
        if lang == "tr":
            cache.translation_tr = translation
        await cache.save()
    else:
        await TranslationCache(
            lemma=lemma,
            translation_tr=translation if lang == "tr" else "",
            translations={lang: translation},
        ).insert()


async def resolve_native_translations(words: list[Word], native_lang: str) -> dict[str, str]:
    """Map word_id → gloss in the user's native language."""
    native_lang = (native_lang or "tr").lower()
    out: dict[str, str] = {}
    missing: list[Word] = []

    for word in words:
        wid = str(word.id)
        if native_lang == "tr":
            out[wid] = word.translation_tr
            continue

        lemma = word.lemma.strip().lower()
        cache = await TranslationCache.find_one(TranslationCache.lemma == lemma)
        cached = (cache.translations or {}).get(native_lang) if cache else None
        if cached:
            out[wid] = cached
        else:
            missing.append(word)

    if not missing:
        return out

    lang_name = LANG_NAMES.get(native_lang, native_lang)
    lemmas = [w.lemma for w in missing]
    try:
        batch = await ai_post(
            "/generate/translate-words",
            {"words": lemmas, "target_lang": lang_name},
        )
        translations: dict = batch.get("translations") or {}
    except Exception:
        # Fallback: keep Turkish gloss so cards remain usable offline
        for word in missing:
            out[str(word.id)] = word.translation_tr
        return out

    for word in missing:
        wid = str(word.id)
        trans = translations.get(word.lemma) or translations.get(word.lemma.lower())
        if trans:
            out[wid] = trans.strip()
            await _cache_translation(word.lemma, native_lang, trans.strip())
        else:
            out[wid] = word.translation_tr

    return out
