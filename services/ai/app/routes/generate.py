import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.generators import (
    generate_chat_suggestions,
    generate_coaching_scenario,
    generate_reading_passage,
    generate_reading_questions,
    generate_scenario_content,
    generate_speak_prompts,
    generate_substitution_drill,
    generate_tense_content,
    generate_vocab_words,
    correct_journal_text,
    enrich_single_word,
    evaluate_student_sentence,
    translate_lyrics_lines,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/generate", tags=["generate"])


def _handle_ai_error(e: Exception) -> HTTPException:
    msg = str(e)
    logger.exception("AI generation failed: %s", msg)
    if "invalid_api_key" in msg or "Incorrect API key" in msg or "401" in msg:
        raise HTTPException(
            401,
            "DashScope API anahtarı geçersiz. .env dosyasındaki DASHSCOPE_API_KEY değerini kontrol edin.",
        ) from e
    if "DASHSCOPE_API_KEY" in msg:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.") from e
    raise HTTPException(502, f"AI üretim hatası: {msg}") from e


class VocabGenerateRequest(BaseModel):
    level: str = "B1"
    topic: str = "English tenses and advanced vocabulary"
    count: int = Field(default=15, ge=5, le=50)
    exclude: list[str] = Field(default_factory=list)
    word_type: str | None = None  # noun, verb, adjective, adverb, phrasal_verb


class TenseGenerateRequest(BaseModel):
    tense_name_en: str
    tense_name_tr: str
    formula: str
    exercise_count: int = Field(default=5, ge=3, le=10)
    exclude_prompts: list[str] = Field(default_factory=list)


class ReadingGenerateRequest(BaseModel):
    level: str = "B1"
    topic: str = "daily life"
    tense_focus: str = "mixed tenses"
    word_count: int = Field(default=120, ge=80, le=250)


@router.post("/vocab")
async def generate_vocab(body: VocabGenerateRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        words = await generate_vocab_words(body.level, body.topic, body.count, body.exclude, body.word_type)
        return {"words": words}
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


@router.post("/tense")
async def generate_tense(body: TenseGenerateRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        content = await generate_tense_content(
            body.tense_name_en,
            body.tense_name_tr,
            body.formula,
            body.exercise_count,
            body.exclude_prompts,
        )
        return content
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


@router.post("/reading")
async def generate_reading(body: ReadingGenerateRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış. Proje kökündeki .env dosyasını kontrol edin.")
    try:
        passage = await generate_reading_passage(
            body.level,
            body.topic,
            body.tense_focus,
            body.word_count,
        )
        return passage
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class TranslateTextRequest(BaseModel):
    text: str
    target_lang: str = "Turkish"


@router.post("/translate_text")
async def translate_text_endpoint(body: TranslateTextRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        from app.llm import get_llm, _chunk_text
        from langchain_core.messages import HumanMessage, SystemMessage
        llm = get_llm(streaming=False)
        system = "You are a professional translator. Translate the text accurately to the target language. Return ONLY the translation, with no other text, commentary, or formatting."
        user = f"Translate the following text to {body.target_lang}:\n\n{body.text}"
        res = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
        translation = _chunk_text(res.content).strip()
        return {"translation": translation}
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class ChatSuggestionsRequest(BaseModel):
    agent_response: str
    user_message: str = ""
    scenario: str = "Serbest sohbet"
    level: str = "B1"


@router.post("/chat-suggestions")
async def chat_suggestions_endpoint(body: ChatSuggestionsRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        suggestions = await generate_chat_suggestions(
            body.agent_response, body.user_message, body.scenario, body.level
        )
        return {"suggestions": suggestions}
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class ScenarioGenerateRequest(BaseModel):
    level: str = "B1"
    topic: str = "daily life"
    target_tense_slug: str | None = None


@router.post("/scenario")
async def generate_scenario_endpoint(body: ScenarioGenerateRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        scenario = await generate_scenario_content(
            body.level,
            body.topic,
            body.target_tense_slug,
        )
        return scenario
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class EvaluateSentenceRequest(BaseModel):
    word: str
    sentence: str
    level: str = "B1"


@router.post("/evaluate-sentence")
async def evaluate_sentence_endpoint(body: EvaluateSentenceRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        evaluation = await evaluate_student_sentence(
            body.word,
            body.sentence,
            body.level,
        )
        return evaluation
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class CorrectTextRequest(BaseModel):
    text: str
    level: str = "B1"


@router.post("/correct-text")
async def correct_text_endpoint(body: CorrectTextRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        return await correct_journal_text(body.text, body.level)
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class EnrichWordRequest(BaseModel):
    lemma: str
    context: str = ""


@router.post("/enrich-word")
async def enrich_word_endpoint(body: EnrichWordRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        return await enrich_single_word(body.lemma, body.context)
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class ReadingQuestionsRequest(BaseModel):
    content: str
    level: str = "B1"
    count: int = Field(default=4, ge=2, le=8)


@router.post("/reading-questions")
async def reading_questions_endpoint(body: ReadingQuestionsRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        questions = await generate_reading_questions(body.content, body.level, body.count)
        return {"questions": questions}
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class TranslateLinesRequest(BaseModel):
    lyrics: str


@router.post("/translate-lines")
async def translate_lines_endpoint(body: TranslateLinesRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        lines = await translate_lyrics_lines(body.lyrics)
        return {"lines": lines}
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class SubstitutionRequest(BaseModel):
    base_word: str
    level: str = "B1"


@router.post("/substitution")
async def substitution_endpoint(body: SubstitutionRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        return await generate_substitution_drill(body.base_word, body.level)
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class CoachingScenarioRequest(BaseModel):
    level: str = "B1"
    target_tense: str = "Past Simple"
    word_pool: list[dict] = Field(default_factory=list)


@router.post("/coaching-scenario")
async def coaching_scenario_endpoint(body: CoachingScenarioRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        result = await generate_coaching_scenario(
            body.level,
            body.target_tense,
            body.word_pool if body.word_pool else None,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)


class SpeakPromptsRequest(BaseModel):
    level: str = "A2"
    topic: str = "daily life"
    word_count: int = Field(default=80, ge=40, le=160)
    word_pool: list[dict] = Field(default_factory=list)
    angle: str = ""
    tense: str = "present habitual"
    exclude_texts: list[str] = Field(default_factory=list)


@router.post("/speak-prompts")
async def speak_prompts_endpoint(body: SpeakPromptsRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY yapılandırılmamış.")
    try:
        return await generate_speak_prompts(
            body.level,
            body.topic,
            body.word_count,
            body.word_pool if body.word_pool else None,
            body.angle,
            body.tense,
            body.exclude_texts if body.exclude_texts else None,
        )
    except HTTPException:
        raise
    except Exception as e:
        _handle_ai_error(e)
