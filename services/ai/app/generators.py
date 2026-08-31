import json
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from app.llm import get_llm

logger = logging.getLogger(__name__)


def _extract_json(text: str):
    text = text.strip()
    if not text:
        raise ValueError("AI boş yanıt döndü")
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            text = match.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        # Truncated model output: salvage complete objects from a "words" array
        salvaged = _salvage_words_array(text)
        if salvaged:
            return {"words": salvaged}
        raise


def _salvage_words_array(text: str) -> list[dict]:
    """Recover as many complete word objects as possible from truncated JSON."""
    start = text.find("[")
    if start == -1:
        return []
    items: list[dict] = []
    i = start + 1
    n = len(text)
    while i < n:
        while i < n and text[i] in " \n\r\t,":
            i += 1
        if i >= n or text[i] == "]":
            break
        if text[i] != "{":
            break
        depth = 0
        in_str = False
        escape = False
        j = i
        while j < n:
            ch = text[j]
            if in_str:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        chunk = text[i : j + 1]
                        try:
                            obj = json.loads(chunk)
                            if isinstance(obj, dict) and obj.get("lemma"):
                                items.append(obj)
                        except json.JSONDecodeError:
                            pass
                        i = j + 1
                        break
            j += 1
        else:
            break
    return items


async def _invoke_json(system: str, user: str, *, max_tokens: int = 4096) -> dict | list:
    llm = get_llm(streaming=False, max_tokens=max_tokens)
    result = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    content = result.content
    if isinstance(content, list):
        content = "".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in content)
    logger.info("AI raw response length: %s", len(str(content)))
    return _extract_json(str(content))


# ── Word type specific prompt templates ──────────────────────────────

WORD_TYPE_PROMPTS = {
    "adjective": {
        "focus": "adjectives (sıfatlar)",
        "extra_fields": """Also include:
- "synonyms": [1-2], "antonyms": [0-2], "collocations": [1-2],
- "forms": {"comparative": "...", "superlative": "..."}""",
        "examples_note": "Use the adjective naturally in the example sentence.",
    },
    "verb": {
        "focus": "verbs (fiiller) — including irregular verbs",
        "extra_fields": """Also include:
- "synonyms": [1-2], "antonyms": [], "collocations": [1-2],
- "forms": {"past": "...", "past_participle": "...", "gerund": "...", "third_person": "..."}""",
        "examples_note": "Use the verb in a natural sentence. Prefer irregular verbs when possible.",
    },
    "adverb": {
        "focus": "adverbs (zarflar)",
        "extra_fields": """Also include:
- "synonyms": [1-2], "antonyms": [], "collocations": [1-2]""",
        "examples_note": "Use the adverb naturally modifying a verb or adjective.",
    },
    "phrasal_verb": {
        "focus": "phrasal verbs (deyimsel fiiller)",
        "extra_fields": """Also include:
- "synonyms": [1-2], "collocations": [1-2],
- "forms": {"past": "...", "past_participle": "...", "gerund": "..."}""",
        "examples_note": "Use the phrasal verb in a conversational example sentence.",
    },
    "noun": {
        "focus": "nouns (isimler)",
        "extra_fields": """Also include:
- "synonyms": [1-2], "antonyms": [], "collocations": [1-2]""",
        "examples_note": "Use the noun in a natural sentence.",
    },
}


async def _generate_vocab_batch(
    level: str,
    topic: str,
    count: int,
    exclude: list[str],
    word_type: str | None,
) -> list[dict]:
    exclude_str = ", ".join(exclude[:60]) if exclude else "yok"
    wt_config = WORD_TYPE_PROMPTS.get(word_type) if word_type else None

    if wt_config:
        focus = wt_config["focus"]
        extra_fields = wt_config["extra_fields"]
        examples_note = wt_config["examples_note"]
        word_type_instruction = f'\n    "word_type": "{word_type}",'
    else:
        focus = "mixed vocabulary (nouns, verbs, adjectives, adverbs, phrasal verbs)"
        extra_fields = '"word_type": "noun|verb|adjective|adverb|phrasal_verb", "synonyms": [1-2], "collocations": [1-2],'
        examples_note = "Use each word naturally in an example sentence."
        word_type_instruction = ""

    system = f"""Sen İngilizce öğretmenisin. Sadece geçerli, kısa JSON döndür — markdown yok, yorum yok.
Format: {{"words":[{{"lemma":"...","translation_tr":"...","example":"...",{word_type_instruction}
"level":"{level}","topic":"...", {extra_fields}}}]}}
Keep examples short (under 12 words). Keep JSON compact."""

    user = f"""Türk öğrenci için {level} seviyesinde tam {count} İngilizce kelime üret.
Odak: {focus}
Konu: {topic}

Kurallar:
- {examples_note}
- A1 temel kelimeler (hello, big, go, run, the, and) KULLANMA.
- Gerçek hayatta kullanılan pratik kelimeler.
- Türkçe çeviriler doğru ve kısa olsun.
- JSON'u mutlaka kapat (tüm {count} kelimeyi tamamla).
- Bunları tekrar etme: {exclude_str}"""

    # ~250-350 tokens per rich word object; batch of 10 needs headroom
    data = await _invoke_json(system, user, max_tokens=min(8192, 900 + count * 280))
    words = data.get("words", data) if isinstance(data, dict) else data
    if not isinstance(words, list):
        return []

    if word_type:
        for w in words:
            w.setdefault("word_type", word_type)
    return [w for w in words if isinstance(w, dict) and w.get("lemma")]


async def generate_vocab_words(
    level: str = "B1",
    topic: str = "tenses and grammar",
    count: int = 15,
    exclude: list[str] | None = None,
    word_type: str | None = None,
) -> list[dict]:
    """Generate vocabulary in small batches so the model does not truncate JSON."""
    exclude_set = {e.strip().lower() for e in (exclude or []) if e}
    collected: list[dict] = []
    batch_size = 10

    remaining = count
    while remaining > 0 and len(collected) < count:
        n = min(batch_size, remaining)
        batch_exclude = list(exclude_set)[:60]
        try:
            batch = await _generate_vocab_batch(level, topic, n, batch_exclude, word_type)
        except Exception:
            # One retry with a smaller batch if the model still truncates
            if n > 5:
                batch = await _generate_vocab_batch(level, topic, 5, batch_exclude, word_type)
            else:
                raise

        added = 0
        for w in batch:
            lemma = str(w.get("lemma", "")).strip().lower()
            if not lemma or lemma in exclude_set:
                continue
            exclude_set.add(lemma)
            collected.append(w)
            added += 1
            if len(collected) >= count:
                break

        if added == 0:
            logger.warning("Vocab batch returned 0 new words (requested %s)", n)
            break
        remaining = count - len(collected)

    return collected[:count]


async def generate_tense_content(
    tense_name_en: str,
    tense_name_tr: str,
    formula: str,
    exercise_count: int = 5,
    exclude_prompts: list[str] | None = None,
) -> dict:
    system = """Sen İngilizce zaman uzmanısın. Sadece geçerli JSON döndür.
Her yeni üretimde tamamen farklı konular (örn: bilim, sanat, uzay, seyahat, mutfak, iş hayatı, spor, teknoloji) ve farklı fiiller/isimler seçerek çeşitliliği maksimum düzeyde tut. Kalıplaşmış ve çok sık kullanılan örnek cümleleri tekrar etme.

Format:
{
  "lesson_tr": "detaylı Türkçe ders anlatımı",
  "tips_tr": ["ipucu1", "ipucu2"],
  "common_mistakes": [{"wrong": "...", "correct": "...", "explanation_tr": "..."}],
  "exercises": [
    {"type": "fill_blank|choose_tense|transform|error_correction", "prompt": "...", "answer": "...", "options": [], "hint_tr": "..."}
  ]
}"""
    exclude_str = ""
    if exclude_prompts:
        exclude_str = "\nBu alıştırma promptlarını/cümlelerini kesinlikle kullanma (farklı cümleler üret):\n" + "\n".join(f"- {p}" for p in exclude_prompts)

    user = f"""Zaman: {tense_name_en} ({tense_name_tr})
Formül: {formula}
{exercise_count} zorlayıcı alıştırma üret. Türk öğrencinin sık yaptığı hataları dahil et.
choose_tense için options dizisinde 3 seçenek olsun.{exclude_str}"""
    return await _invoke_json(system, user)


async def generate_reading_passage(
    level: str = "B1",
    topic: str = "daily life",
    tense_focus: str = "mixed tenses",
    word_count: int = 120,
) -> dict:
    system = """Sen İngilizce öğretmenisin. Sadece geçerli JSON döndür.
Format: {"title": "...", "content": "...", "level": "B1", "tense_focus": "...", "summary_tr": "..."}"""
    user = f"""{level} seviyesinde yaklaşık {word_count} kelimelik İngilizce okuma metni yaz.
Konu: {topic}
Zaman odağı: {tense_focus}
Metin doğal olsun, uzun cümleler içersin (öğrenci okuma pratiği için).
summary_tr: metnin 1 cümlelik Türkçe özeti."""
    return await _invoke_json(system, user)


async def generate_chat_suggestions(
    agent_response: str,
    user_message: str,
    scenario: str = "Serbest sohbet",
    level: str = "B1",
) -> list[str]:
    """Generate dynamic conversation suggestions based on chat context."""
    system = "You are a helpful language assistant. Reply ONLY with a valid JSON array of strings."
    user = f"""The English conversation partner said: "{agent_response}"
The student (level {level}) wrote: "{user_message}"
Scenario: {scenario}

Generate 4 short, natural English responses (3-10 words each) that the student could say next.
Vary the responses: one question, one opinion, one agreement/disagreement, one extending the topic.
Return ONLY a JSON array of strings."""

    try:
        data = await _invoke_json(system, user)
        if isinstance(data, list):
            return data[:4]
        return []
    except Exception as e:
        logger.warning("Failed to generate suggestions: %s", e)
        return []


async def generate_scenario_content(
    level: str = "B1",
    topic: str = "daily life",
    target_tense_slug: str | None = None,
) -> dict:
    tense_str = f"Target grammar/tense focus: {target_tense_slug}." if target_tense_slug else "No specific tense focus (mixed tenses)."
    system = """Sen İngilizce öğretmenisin. Sadece geçerli JSON döndür, başka metin yazma.
Format: {"title": "Türkçe başlık", "context": "English context for the student", "opening_line": "English opening line by the conversation partner", "category": "daily|travel|work|health|general"}"""
    
    user = f"""{level} seviyesindeki bir Türk öğrenci için İngilizce sohbet senaryosu oluştur.
Konu: {topic}
{tense_str}

Kurallar:
- 'title' Türkçe ve çok kısa olmalı (örn: 'Otobüs Durağında', 'İş Toplantısı').
- 'context' İngilizce olmalı, öğrencinin rolünü ve amacını netçe ama kısa ve basitçe açıklamalı (1-2 cümle).
- 'opening_line' konuşma ortağının (AI) söyleyeceği İLK cümle olmalı. Doğal, konuşma başlatıcı ve seviyeye ({level}) kesinlikle uygun olmalıdır. A1/A2 için çok basit ve anlaşılır, C1/C2 için daha deyimsel ve doğal olmalıdır.
- 'category' değeri 'daily', 'travel', 'work', 'health', veya 'general' olmalıdır.
- JSON formatı dışında hiçbir şey döndürme."""

    return await _invoke_json(system, user)


async def correct_journal_text(text: str, level: str = "B1") -> dict:
    """Correct a free-form English journal entry and give friendly Turkish feedback."""
    system = """You are a supportive English teacher reviewing a student's journal entry.
Return ONLY valid JSON with no markdown, code blocks, or extra commentary.

Format:
{
  "corrections": [
    {"wrong": "the exact wrong phrase", "correct": "the corrected version", "explanation_tr": "brief explanation in Turkish (1 sentence)"}
  ],
  "improved_text": "the full corrected, natural version of the student's text",
  "feedback_tr": "warm, encouraging feedback in Turkish (1-2 sentences)"
}"""
    user = f"""Student English level: {level}
Student's journal text:
\"\"\"{text}\"\"\"

Correct grammar, word choice, and naturalness while keeping the student's original meaning and tense.
List concrete corrections (empty list if the text is already correct) and provide the full improved version."""
    return await _invoke_json(system, user)


async def enrich_single_word(lemma: str, context: str = "") -> dict:
    """Given an English word (and optional context), return its Turkish meaning and metadata."""
    system = """You are an English-Turkish dictionary. Return ONLY valid JSON, no markdown or extra text.
Format:
{
  "lemma": "the base/dictionary form of the word (lowercase)",
  "translation_tr": "concise, natural Turkish meaning",
  "example": "a simple English example sentence using the word",
  "word_type": "noun|verb|adjective|adverb|phrasal_verb|preposition|conjunction",
  "level": "A1|A2|B1|B2|C1"
}"""
    context_str = f'\nContext where the learner saw/heard it: "{context}"' if context.strip() else ""
    user = f"""English word/phrase: "{lemma}"{context_str}

Give its most common Turkish meaning (matching the context if provided), a simple example sentence, its part of speech, and CEFR level."""
    return await _invoke_json(system, user)


async def generate_reading_questions(content: str, level: str = "B1", count: int = 4) -> list[dict]:
    """Generate multiple-choice reading comprehension questions for a passage."""
    system = """You are an English teacher creating a reading comprehension quiz.
Return ONLY valid JSON, no markdown or extra text.
Format:
{"questions": [
  {"question": "English question about the passage", "options": ["opt1", "opt2", "opt3", "opt4"], "answer": "the exact correct option text", "explanation_tr": "why it is correct, in Turkish (1 sentence)"}
]}"""
    user = f"""Reading passage (student level {level}):
\"\"\"{content}\"\"\"

Write {count} multiple-choice comprehension questions.
Rules:
- Each question has exactly 4 options.
- 'answer' must be identical to one of the options.
- Questions must be answerable purely from the passage.
- Vary between main idea, detail, and inference."""
    data = await _invoke_json(system, user)
    questions = data.get("questions", data) if isinstance(data, dict) else data
    return questions if isinstance(questions, list) else []


async def translate_lyrics_lines(lyrics: str) -> list[dict]:
    """Translate song lyrics line by line, preserving order and blank lines."""
    system = """You are a professional song-lyrics translator (English to Turkish).
Return ONLY valid JSON, no markdown or extra text.
Format: {"lines": [{"en": "original English line", "tr": "natural Turkish translation"}]}"""
    user = f"""Translate these English song lyrics into Turkish, line by line.
Rules:
- Keep the SAME number of lines and the SAME order as the input.
- Preserve empty lines as objects with empty "en" and "tr".
- Translate naturally (meaning over word-for-word), suitable for a learner following along.

Lyrics:
\"\"\"{lyrics}\"\"\""""
    data = await _invoke_json(system, user)
    lines = data.get("lines", data) if isinstance(data, dict) else data
    return lines if isinstance(lines, list) else []


async def generate_substitution_drill(base_word: str, level: str = "B1") -> dict:
    """Build a substitution drill: one sentence pattern with several swap-in variants."""
    system = """You are an English teacher creating a substitution drill (drilling one sentence pattern by swapping words).
Return ONLY valid JSON, no markdown or extra text.
Format:
{
  "pattern": "an English sentence pattern with a ___ blank, e.g. 'I decided to ___ after work.'",
  "translation_tr": "Turkish translation of the pattern with 'bir şey' for the blank",
  "base_sentence": "the pattern filled with the base word",
  "variants": [
    {"word": "a word that fits the blank", "sentence_en": "full sentence with the word", "sentence_tr": "Turkish translation"}
  ]
}"""
    user = f"""Base word: "{base_word}"
Student level: {level}

Create ONE natural sentence pattern that contains "{base_word}" in a swappable slot (the slot is where different words can be substituted).
Then give 4-5 alternative words that grammatically and naturally fit the SAME slot, each with a full example sentence and its Turkish translation.
Keep the pattern and sentences at {level} level."""
    return await _invoke_json(system, user)


async def evaluate_student_sentence(word: str, sentence: str, level: str = "B1") -> dict:
    system = """You are an expert English teacher. Evaluate the student's English sentence which was written to practice a specific vocabulary word.
Return ONLY valid JSON with no markdown formatting, no code blocks, and no extra commentary.

Format:
{
  "is_correct": true/false,
  "target_word_used_correctly": true/false,
  "corrections": [
    {
      "wrong": "the exact wrong phrase",
      "correct": "the corrected version",
      "explanation_tr": "brief explanation in Turkish (1-2 sentences)"
    }
  ],
  "natural_alternative": "a natural, simple English sentence using the target word in a similar context",
  "feedback_tr": "friendly feedback in Turkish about the student's usage of the word (1-2 sentences)"
}"""

    user = f"""Target vocabulary word: {word}
Student's sentence: "{sentence}"
Target English level of the student: {level}

Evaluate the sentence:
1. Is it grammatically correct for a {level} student?
2. Did the student use the target word '{word}' correctly in context and with the correct meaning and part of speech?
3. Provide corrections in Turkish if there are errors.
4. Give a natural alternative sentence using the word.
5. Give friendly feedback in Turkish."""

    return await _invoke_json(system, user)


async def generate_speak_prompts(
    level: str = "A2",
    topic: str = "daily life",
    word_count: int = 80,
    word_pool: list[dict] | None = None,
    angle: str = "",
    tense: str = "present habitual",
    exclude_texts: list[str] | None = None,
    native_lang: str = "tr",
    target_lang: str = "en",
) -> dict:
    """Generate a cohesive text in the learner's native language for oral translation practice."""
    LANG_NAMES: dict[str, str] = {
        "tr": "Turkish", "en": "English", "de": "German", "es": "Spanish",
        "fr": "French", "ar": "Arabic", "ru": "Russian", "zh": "Chinese",
        "ja": "Japanese", "ko": "Korean", "pt": "Portuguese", "it": "Italian",
        "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian",
    }

    native_name = LANG_NAMES.get(native_lang, native_lang)
    target_name = LANG_NAMES.get(target_lang, target_lang)

    word_list_str = ""
    if word_pool:
        items = [f"- {w.get('lemma', '')}" for w in word_pool[:20] if w.get("lemma")]
        word_list_str = "\n".join(items)

    exclude_note = ""
    if exclude_texts:
        clipped = [t.strip()[:180] for t in exclude_texts if t and t.strip()][:5]
        if clipped:
            bullets = "\n".join(f"- {t}…" for t in clipped)
            exclude_note = (
                f"\n\nPREVIOUS TEXTS (do NOT repeat the same events or wording):\n{bullets}"
            )

    tense_guide = {
        "present habitual": "present simple / habitual — describe a routine or habit",
        "present continuous": "present continuous — describe a scene happening now",
        "past simple": "past simple — describe a concrete event today or yesterday",
        "future": "future — describe a plan for tomorrow or soon",
    }
    tense_hint = tense_guide.get(tense, tense_guide["present habitual"])

    system = f"""You are a native {native_name} writer. Each request must be a COMPLETELY NEW text.
The student will read the {native_name} paragraph aloud and speak the {target_name} translation.
Return ONLY valid JSON; no markdown or extra commentary.
Format:
{{
  "topic_tr": "short title in {native_name} (specific to this text, not the generic category name)",
  "tips_tr": "one-sentence tip in {native_name} for translating this text",
  "text_tr": "natural, fluent, connected paragraph in {native_name}",
  "text_en": "natural spoken {target_name} translation of the full paragraph",
  "focus_words": ["key", "english", "lemmas"],
  "hint_tr": "short grammar hint in {native_name}, or empty string"
}}

CRITICAL — text_tr rules:
- Write like everyday speech for a native {native_name} speaker; no translationese.
- Follow the given scene/angle strictly; ban cliché morning routines unless the angle requires it.
- Use a different place, person, mood, or small event each time.
- Keep tense consistent.
- No lists of disconnected sentences; use simple, everyday vocabulary."""

    words_note = (
        f"\nIn the {target_name} translation, naturally prefer these English lemmas where possible "
        f"(do not force the {native_name} text to fit awkwardly):\n{word_list_str}"
        if word_list_str
        else f"\nUse everyday, simple words in the {target_name} translation."
    )

    user = f"""Category: {topic}
Required scene / angle: {angle or "a specific but ordinary moment from daily life"}
Tense: {tense_hint}
Student level ({target_name} output): {level}
Target length: about {word_count} words in {native_name} (±20%).
{words_note}
{exclude_note}

First write a fresh, natural {native_name} paragraph for this scene; then translate it to {target_name}.
text_en must be natural spoken {target_name} at {level} level and cover the full {native_name} text.
focus_words = 4–8 important English lemmas from the translation.
No numbering or bullet points in text_tr."""
    return await _invoke_json(system, user)


async def generate_coaching_scenario(
    level: str = "B1",
    target_tense: str = "Past Simple",
    word_pool: list[dict] | None = None,
) -> dict:
    """Generate a coaching scenario description dynamically based on level, tense, and words."""
    word_list_str = ""
    if word_pool:
        items = [f"- {w.get('lemma', '')} ({w.get('tr', '')})" for w in word_pool[:12]]
        word_list_str = "\n".join(items)

    system = """Sen İngilizce konuşma koçusun. Türk öğrenciler için senaryo tabanlı konuşma pratikleri tasarlıyorsun.
Sadece geçerli JSON döndür, başka metin yazma.
Format:
{
  "title_tr": "Kısa Türkçe başlık (3-5 kelime)",
  "description_tr": "2-3 cümlelik Türkçe senaryo açıklaması. Öğrencinin ne yapması gerektiğini, kimle konuştuğunu ve amacını anlat.",
  "target_tense": "Hedef İngilizce zaman adı (aynen verilen)",
  "target_tense_example": "Bu zamanı kullanan kısa bir İngilizce örnek cümle"
}"""

    if target_tense.lower() in ("mixed", "karışık", "karışık (mixed)", "mixed (karışık - serbest)"):
        tense_note = "Hedef zaman: Karışık / Serbest (Öğrenci herhangi bir zamanı serbestçe kullanabilir, tek bir zamana odaklanmak yerine doğal bir sohbet yürütür)."
        example_instruction = "- 'target_tense_example' için senaryoya uygun herhangi bir doğal İngilizce cümle yaz."
    else:
        tense_note = f"Hedef zaman: {target_tense}"
        example_instruction = "- 'target_tense_example' bu zamanı (target_tense) kullanan kısa bir İngilizce örnek cümle olmalı."

    words_note = f"\nKullanılması istenen kelimeler:\n{word_list_str}" if word_list_str else ""

    user = f"""{level} seviyesindeki bir Türk öğrenci için doğal ve ilgi çekici bir konuşma senaryosu üret.
{tense_note}
{words_note}

Kurallar:
- Senaryo günlük hayattan, gerçekçi ve ilgi çekici olmalı.
- 'description_tr' Türkçe olmalı, öğrencinin hangi rolde olduğunu ve ne yapması gerektiğini net açıklamalı.
- Eğer kelime listesi verildiyse, bu kelimelerin doğal olarak kullanılabileceği bir durum yarat.
{example_instruction}
- JSON formatı dışında hiçbir şey döndürme."""

    return await _invoke_json(system, user)

