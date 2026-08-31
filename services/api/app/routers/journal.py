from datetime import date, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models import JournalEntry, UserAttempt
from app.services.ai_client import ai_post

router = APIRouter(prefix="/journal", tags=["journal"])


class CheckBody(BaseModel):
    text: str
    level: str = "B1"


class SaveBody(BaseModel):
    future_text: str = ""
    past_text: str = ""
    corrections: list[dict] = []
    feedback_tr: str | None = None
    level: str = "B1"


@router.post("/check")
async def check_journal(body: CheckBody):
    if not body.text.strip():
        raise HTTPException(400, "Metin boş olamaz")
    try:
        return await ai_post("/generate/correct-text", {"text": body.text, "level": body.level})
    except Exception as e:
        raise HTTPException(502, f"AI kontrolü başarısız: {e}") from e


@router.post("")
async def save_journal(body: SaveBody):
    user_id = settings.default_user_id
    today = date.today().isoformat()

    entry = await JournalEntry.find_one(
        JournalEntry.user_id == user_id,
        JournalEntry.entry_date == today,
    )
    if entry:
        entry.future_text = body.future_text
        entry.past_text = body.past_text
        entry.corrections = body.corrections
        entry.feedback_tr = body.feedback_tr
        entry.updated_at = datetime.utcnow()
        await entry.save()
    else:
        entry = JournalEntry(
            user_id=user_id,
            entry_date=today,
            future_text=body.future_text,
            past_text=body.past_text,
            corrections=body.corrections,
            feedback_tr=body.feedback_tr,
        )
        await entry.insert()

    # Log activity so the dashboard streak / daily goal reflects journaling
    await UserAttempt(
        user_id=user_id,
        source_type="journal",
        answer=(body.future_text + " " + body.past_text).strip()[:500],
        is_correct=True,
    ).insert()

    return {"id": str(entry.id), "entry_date": entry.entry_date}


@router.get("")
async def journal_history(limit: int = 30):
    user_id = settings.default_user_id
    entries = (
        await JournalEntry.find(JournalEntry.user_id == user_id)
        .sort("-created_at")
        .limit(limit)
        .to_list()
    )
    return {
        "items": [
            {
                "id": str(e.id),
                "entry_date": e.entry_date,
                "future_text": e.future_text,
                "past_text": e.past_text,
                "feedback_tr": e.feedback_tr,
            }
            for e in entries
        ]
    }
