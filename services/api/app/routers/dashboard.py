from datetime import datetime, date, timedelta, time, timezone
from fastapi import APIRouter

from app.config import settings
from app.database import check_db
from app.models import ErrorPoolItem, Exercise, Tense, User, UserAttempt, Word, KnownWord, UserWord
from app.services.srs import get_error_queue, get_vocab_queue, review_error_item, review_word

router = APIRouter()


@router.get("/health")
async def health():
    db_ok = False
    try:
        db_ok = await check_db()
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "mongodb": db_ok}


@router.get("/dashboard")
async def dashboard():
    user_id = settings.default_user_id
    word_count = await Word.count()
    tense_count = await Tense.count()
    error_count = await ErrorPoolItem.find(ErrorPoolItem.user_id == user_id).count()
    attempts = await UserAttempt.find(UserAttempt.user_id == user_id).count()
    correct = await UserAttempt.find(UserAttempt.user_id == user_id, UserAttempt.is_correct == True).count()
    vocab_queue = await get_vocab_queue(limit=5)
    user = await User.find_one(User.user_id == user_id)

    known_words_count = await KnownWord.find(KnownWord.user_id == user_id).count()
    user_words_count = await UserWord.find(UserWord.user_id == user_id).count()
    vocab_learned = max(known_words_count, user_words_count)

    tenses = await Tense.find_all().to_list()
    tenses_learned = 0
    for t in tenses:
        correct_count = await UserAttempt.find(
            UserAttempt.user_id == user_id,
            UserAttempt.tense_id == t.id,
            UserAttempt.is_correct == True
        ).count()
        if correct_count >= 5:
            tenses_learned += 1

    # Calculate streak
    attempts_list = await UserAttempt.find(UserAttempt.user_id == user_id).sort("-created_at").to_list()
    known_words = await KnownWord.find(KnownWord.user_id == user_id).sort("-marked_at").to_list()

    activity_dates = set()
    for a in attempts_list:
        activity_dates.add(a.created_at.date())
    for kw in known_words:
        activity_dates.add(kw.marked_at.date())

    sorted_dates = sorted(list(activity_dates), reverse=True)
    streak = 0
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)

    if today in sorted_dates or yesterday in sorted_dates:
        current_date = today if today in sorted_dates else yesterday
        streak = 1
        while (current_date - timedelta(days=1)) in sorted_dates:
            streak += 1
            current_date -= timedelta(days=1)

    # Today's completed tasks count
    today_start = datetime.combine(today, time.min)
    vocab_today = await KnownWord.find(
        KnownWord.user_id == user_id,
        KnownWord.marked_at >= today_start
    ).count()
    attempts_today = await UserAttempt.find(
        UserAttempt.user_id == user_id,
        UserAttempt.created_at >= today_start
    ).count()
    completed_today = vocab_today + attempts_today

    return {
        "stats": {
            "words_total": word_count,
            "tenses_total": tense_count,
            "errors_pending": error_count,
            "attempts_total": attempts,
            "accuracy": round(correct / attempts * 100, 1) if attempts else 0,
            "daily_goal": user.daily_goal if user else 20,
            "vocab_learned": vocab_learned,
            "tenses_learned": tenses_learned,
            "streak": streak,
            "completed_today": completed_today,
        },
        "vocab_due": len(vocab_queue),
        "errors_due": error_count,
    }

