from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.models import ChatSession

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str
    content: str
    correction_tr: str | None = None
    translation_tr: str | None = None
    corrections: list[dict] = Field(default_factory=list)
    new_words: list[str] = Field(default_factory=list)
    fluency_note: str | None = None


class SessionSummary(BaseModel):
    id: str
    title: str
    scenario: str
    tense: str
    mode: str
    level: str
    message_count: int
    preview: str
    updated_at: str


class SessionDetail(BaseModel):
    id: str
    title: str
    scenario: str
    tense: str
    mode: str
    level: str
    messages: list[ChatMessage]
    updated_at: str


class CreateSessionBody(BaseModel):
    scenario: str = "Serbest sohbet"
    tense: str = "Genel"
    mode: str = "free"
    level: str = "B1"
    title: str | None = None


class SaveSessionBody(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    title: str | None = None
    level: str | None = None
    scenario: str | None = None
    tense: str | None = None
    mode: str | None = None


class ChatHistoryResponse(BaseModel):
    session_id: str
    scenario: str
    tense: str
    messages: list[ChatMessage]


class SaveChatHistoryRequest(BaseModel):
    scenario: str = "Serbest sohbet"
    tense: str = "Genel"
    mode: str = "free"
    messages: list[ChatMessage] = Field(default_factory=list)


def _parse_messages(raw: list) -> list[ChatMessage]:
    parsed: list[ChatMessage] = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        data = {
            **m,
            "new_words": m.get("new_words") or m.get("newWords") or [],
            "fluency_note": m.get("fluency_note") or m.get("fluencyNote"),
            "corrections": m.get("corrections") or [],
            "translation_tr": m.get("translation_tr"),
        }
        try:
            parsed.append(ChatMessage(**data))
        except Exception:
            parsed.append(ChatMessage(role=str(m.get("role", "user")), content=str(m.get("content", ""))))
    return parsed


def _title_from_messages(messages: list[ChatMessage], fallback: str = "Yeni sohbet") -> str:
    for m in messages:
        if m.role == "user" and m.content.strip():
            text = m.content.strip().replace("\n", " ")
            return text[:48] + ("…" if len(text) > 48 else "")
    return fallback


def _preview(messages: list) -> str:
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("content"):
            text = str(m["content"]).strip().replace("\n", " ")
            return text[:72] + ("…" if len(text) > 72 else "")
    return ""


def _summary(session: ChatSession) -> SessionSummary:
    return SessionSummary(
        id=str(session.id),
        title=getattr(session, "title", None) or session.scenario or "Yeni sohbet",
        scenario=session.scenario,
        tense=session.tense,
        mode=session.mode,
        level=getattr(session, "level", "B1") or "B1",
        message_count=len(session.messages or []),
        preview=_preview(session.messages or []),
        updated_at=(session.updated_at or session.created_at or datetime.utcnow()).isoformat(),
    )


def _detail(session: ChatSession) -> SessionDetail:
    return SessionDetail(
        id=str(session.id),
        title=getattr(session, "title", None) or session.scenario or "Yeni sohbet",
        scenario=session.scenario,
        tense=session.tense,
        mode=session.mode,
        level=getattr(session, "level", "B1") or "B1",
        messages=_parse_messages(session.messages or []),
        updated_at=(session.updated_at or session.created_at or datetime.utcnow()).isoformat(),
    )


# ── Session API (ChatGPT-style) ──────────────────────────────────────

@router.get("/sessions")
async def list_sessions(limit: int = 50):
    user_id = settings.default_user_id
    sessions = (
        await ChatSession.find(ChatSession.user_id == user_id)
        .sort("-updated_at")
        .limit(limit)
        .to_list()
    )
    return {"items": [_summary(s) for s in sessions]}


@router.post("/sessions", response_model=SessionDetail)
async def create_session(body: CreateSessionBody):
    session = ChatSession(
        user_id=settings.default_user_id,
        title=body.title or "Yeni sohbet",
        scenario=body.scenario,
        tense=body.tense,
        mode=body.mode,
        level=body.level,
        messages=[],
    )
    await session.insert()
    return _detail(session)


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str):
    session = await ChatSession.get(session_id)
    if not session or session.user_id != settings.default_user_id:
        raise HTTPException(404, "Sohbet bulunamadı")
    return _detail(session)


@router.put("/sessions/{session_id}", response_model=SessionDetail)
async def save_session(session_id: str, body: SaveSessionBody):
    session = await ChatSession.get(session_id)
    if not session or session.user_id != settings.default_user_id:
        raise HTTPException(404, "Sohbet bulunamadı")

    session.messages = [m.model_dump() for m in body.messages]
    if body.level:
        session.level = body.level
    if body.scenario:
        session.scenario = body.scenario
    if body.tense:
        session.tense = body.tense
    if body.mode:
        session.mode = body.mode

    # Auto-title from first user message if still default / empty
    if body.title:
        session.title = body.title
    elif not session.title or session.title in {"Yeni sohbet", session.scenario}:
        session.title = _title_from_messages(body.messages, session.scenario)

    session.updated_at = datetime.utcnow()
    await session.save()
    return _detail(session)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    session = await ChatSession.get(session_id)
    if not session or session.user_id != settings.default_user_id:
        raise HTTPException(404, "Sohbet bulunamadı")
    await session.delete()
    return {"deleted": True, "id": session_id}


# ── Legacy endpoints (scenario+tense keyed) ──────────────────────────

async def _get_or_create_session(scenario: str, tense: str, mode: str) -> ChatSession:
    user_id = settings.default_user_id
    session = await ChatSession.find_one(
        ChatSession.user_id == user_id,
        ChatSession.scenario == scenario,
        ChatSession.tense == tense,
    )
    if not session:
        session = ChatSession(
            user_id=user_id,
            title=scenario,
            scenario=scenario,
            tense=tense,
            mode=mode,
        )
        await session.insert()
    return session


@router.get("/history", response_model=ChatHistoryResponse)
async def get_history(scenario: str = "Serbest sohbet", tense: str = "Genel", mode: str = "free"):
    session = await _get_or_create_session(scenario, tense, mode)
    return ChatHistoryResponse(
        session_id=str(session.id),
        scenario=session.scenario,
        tense=session.tense,
        messages=_parse_messages(session.messages or []),
    )


@router.put("/history", response_model=ChatHistoryResponse)
async def save_history(body: SaveChatHistoryRequest):
    session = await _get_or_create_session(body.scenario, body.tense, body.mode)
    session.messages = [m.model_dump() for m in body.messages]
    session.mode = body.mode
    if not session.title or session.title == "Yeni sohbet":
        session.title = _title_from_messages(body.messages, body.scenario)
    session.updated_at = datetime.utcnow()
    await session.save()
    return ChatHistoryResponse(
        session_id=str(session.id),
        scenario=session.scenario,
        tense=session.tense,
        messages=_parse_messages(session.messages),
    )
