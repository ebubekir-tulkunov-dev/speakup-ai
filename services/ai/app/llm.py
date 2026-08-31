import os

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_qwq import ChatQwen

from app.config import DASHSCOPE_INTL_BASE, configure_dashscope_env, settings

CHAT_SCENARIO_PROMPT = """You are an English conversation partner. The user's native language is Turkish but you speak ONLY in English.

Scenario: {scenario}
Target tense: {tense}
Target English Level: {level}

Rules:
- Stay in character for the role-play scenario; use natural English.
- Use the target tense in your own sentences.
- Do NOT correct grammar, do NOT give hints, do NOT write in Turkish.
- Don't tell the user what to say; ask questions or respond naturally.
- Keep responses short and natural (1-3 sentences).
- Adjust your vocabulary complexity, grammar structure, and sentence length to match the target English level {level}. For A1-A2, use very simple words and short sentences. For B1-B2, use intermediate grammar and vocabulary. For C1-C2, use advanced vocabulary and natural idioms.
"""

CHAT_FREE_PROMPT = """You are an English conversation partner. The user's native language is Turkish but you speak ONLY in English.

Free chat mode.
Target English Level: {level}

Rules:
- Give natural, short English responses.
- Do NOT correct grammar, do NOT write in Turkish, do NOT be a teacher.
- Adjust your vocabulary complexity, grammar structure, and sentence length to match the target English level {level}. For A1-A2, use very simple words and short sentences. For B1-B2, use intermediate grammar and vocabulary. For C1-C2, use advanced vocabulary and natural idioms.
"""

ERROR_ANALYSIS_PROMPT = """You are an expert English grammar analyzer for Turkish students.

Target tense: {tense}
Scenario: {scenario}
Target English Level: {level}

Analyze the student's English message and return a JSON object with this exact structure:
{{
  "corrections": [
    {{
      "wrong": "the exact wrong phrase from the student",
      "correct": "the corrected version",
      "rule": "grammar rule name (e.g. Past Simple, Articles, Subject-Verb Agreement)",
      "explanation_tr": "brief explanation in Turkish (1-2 sentences)"
    }}
  ],
  "new_words_used": ["list of any advanced/good vocabulary the student used (empty if none)"],
  "fluency_note": "one-line observation in Turkish about the student's fluency (e.g. 'Cümle kuruluşu iyi ama zamanlar karışıyor')"
}}

Rules:
- Only include REAL grammar errors, not stylistic preferences
- If there are NO errors, return empty corrections array
- new_words_used: highlight any advanced vocabulary the student used well
- For greetings, simple acknowledgments ("yes", "ok", "hello"), return empty corrections and no fluency note
- Adjust your grammar feedback and expectations to the student's level ({level}). For lower levels (A1-A2), focus on major errors and use simpler language in explanation_tr. For higher levels (B2-C2), pay attention to subtle style/usage nuances.
- Return ONLY valid JSON, no markdown formatting, no code blocks
"""


def _chat_prompt(scenario: str, tense: str, mode: str, level: str = "B1") -> str:
    free_chat = scenario in {"Serbest sohbet", "Free conversation"}
    if mode == "scenario" and not free_chat:
        return CHAT_SCENARIO_PROMPT.format(scenario=scenario, tense=tense, level=level)
    return CHAT_FREE_PROMPT.format(level=level)


def get_llm(*, streaming: bool = True, max_tokens: int = 1024) -> ChatQwen:
    configure_dashscope_env()
    api_base = settings.dashscope_api_base or DASHSCOPE_INTL_BASE
    return ChatQwen(
        model=settings.qwen_model,
        api_key=settings.dashscope_api_key or os.getenv("DASHSCOPE_API_KEY"),
        base_url=api_base,
        max_tokens=max_tokens,
        streaming=streaming,
        enable_thinking=False,
    )


def _chunk_text(content) -> str:
    if isinstance(content, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content) if content else ""


async def chat_stream(
    message: str,
    history: list[dict],
    scenario: str = "Serbest sohbet",
    tense: str = "Genel",
    mode: str = "free",
    level: str = "B1",
):
    llm = get_llm(streaming=True, max_tokens=1024)
    messages = [SystemMessage(content=_chat_prompt(scenario, tense, mode, level))]
    for h in history[-10:]:
        if h["role"] == "user":
            messages.append(HumanMessage(content=h["content"]))
        else:
            messages.append(AIMessage(content=h["content"]))
    messages.append(HumanMessage(content=message))

    async for chunk in llm.astream(messages):
        text = _chunk_text(chunk.content)
        if text:
            yield text


async def analyze_error(
    message: str,
    scenario: str = "Serbest sohbet",
    tense: str = "Genel",
    level: str = "B1",
) -> dict | None:
    """Analyze student's message for grammar errors. Returns structured JSON feedback."""
    import json

    llm = get_llm(streaming=False, max_tokens=800)
    prompt = ERROR_ANALYSIS_PROMPT.format(scenario=scenario, tense=tense, level=level)
    result = await llm.ainvoke(
        [
            SystemMessage(content=prompt),
            HumanMessage(content=f'Student message: "{message}"'),
        ]
    )
    text = _chunk_text(result.content).strip()
    if not text or text.upper() == "YOK":
        return None

    # Try to parse as JSON
    try:
        # Clean markdown code blocks if present
        if "```" in text:
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
            if match:
                text = match.group(1).strip()
        data = json.loads(text)
        # Validate structure
        if isinstance(data, dict) and "corrections" in data:
            return data
    except (json.JSONDecodeError, Exception):
        pass

    # Fallback: return as old-style text correction for backward compatibility
    if text and text.upper() != "YOK":
        return {
            "corrections": [],
            "new_words_used": [],
            "fluency_note": text,
        }
    return None


async def translate_word(word: str) -> str:
    llm = get_llm(streaming=False, max_tokens=64)
    prompt = f"Translate this English word to Turkish. Reply with only the Turkish translation, nothing else: {word}"
    result = await llm.ainvoke([HumanMessage(content=prompt)])
    return _chunk_text(result.content).strip()
