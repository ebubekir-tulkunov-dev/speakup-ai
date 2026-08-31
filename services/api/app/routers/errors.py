from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.srs import get_error_queue, review_error_item

router = APIRouter(prefix="/errors", tags=["errors"])


class ErrorReviewBody(BaseModel):
    is_correct: bool


@router.get("/queue")
async def error_queue(limit: int = 20):
    return {"items": await get_error_queue(limit=limit)}


@router.post("/{item_id}/review")
async def error_review(item_id: str, body: ErrorReviewBody):
    try:
        return await review_error_item(item_id, body.is_correct)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
