from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import asyncio

from app.config import settings
from app.llm import analyze_error, chat_stream, translate_word
from app.routes.generate import router as generate_router

app = FastAPI(title="Dil Programı AI", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []
    scenario: str = "Free conversation"
    tense: str = "General"
    mode: str = "free"
    level: str = "B1"


class TranslateRequest(BaseModel):
    word: str


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": settings.qwen_model,
        "api_base": settings.dashscope_api_base,
        "api_key_configured": bool(settings.dashscope_api_key),
    }


@app.post("/chat")
async def chat(body: ChatRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY not configured")

    async def event_generator():
        try:
            error_task = asyncio.create_task(
                analyze_error(body.message, body.scenario, body.tense, body.level)
            )

            full_response = ""
            async for token in chat_stream(
                body.message,
                body.history,
                body.scenario,
                body.tense,
                body.mode,
                body.level,
            ):
                full_response += token
                yield {"event": "token", "data": token}

            feedback = await error_task
            if feedback:
                import json
                # Send structured feedback as JSON
                yield {"event": "feedback", "data": json.dumps(feedback, ensure_ascii=False)}
                # Also send legacy correction for backward compatibility
                corrections = feedback.get("corrections", [])
                if corrections:
                    correction_text = "; ".join(
                        f"{c.get('wrong', '')} → {c.get('correct', '')} ({c.get('explanation_tr', '')})"
                        for c in corrections
                    )
                    yield {"event": "correction", "data": correction_text}
                elif feedback.get("fluency_note"):
                    yield {"event": "correction", "data": feedback["fluency_note"]}

            yield {"event": "done", "data": ""}
        except Exception as e:
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(event_generator())


@app.post("/translate")
async def translate(body: TranslateRequest):
    if not settings.dashscope_api_key:
        raise HTTPException(503, "DASHSCOPE_API_KEY not configured")
    translation = await translate_word(body.word)
    return {"lemma": body.word, "translation_tr": translation}


app.include_router(generate_router)
