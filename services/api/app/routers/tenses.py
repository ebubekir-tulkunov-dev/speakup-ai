import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.models import Exercise, Tense, UserAttempt
from app.services.content_gen import generate_and_save_tense_lesson
from app.services.srs import add_to_error_pool

router = APIRouter(prefix="/tenses", tags=["tenses"])


class SubmitAnswer(BaseModel):
    answer: str
    duration_ms: int = 0


class GenerateTenseBody(BaseModel):
    exercise_count: int = Field(default=5, ge=3, le=10)

TENSE_ORDER = [
    "present-simple",
    "present-continuous",
    "present-perfect",
    "present-perfect-continuous",
    "past-simple",
    "past-continuous",
    "past-perfect",
    "past-perfect-continuous",
    "future-simple",
    "future-continuous",
    "future-perfect",
    "future-perfect-continuous"
]


@router.get("")
async def list_tenses():
    tenses = await Tense.find_all().to_list()
    tenses.sort(key=lambda t: TENSE_ORDER.index(t.slug) if t.slug in TENSE_ORDER else 999)
    user_id = settings.default_user_id
    items = []
    for t in tenses:
        attempts_count = await UserAttempt.find(
            UserAttempt.user_id == user_id,
            UserAttempt.tense_id == t.id
        ).count()
        correct_count = await UserAttempt.find(
            UserAttempt.user_id == user_id,
            UserAttempt.tense_id == t.id,
            UserAttempt.is_correct == True
        ).count()
        items.append({
            "id": str(t.id),
            "slug": t.slug,
            "name_en": t.name_en,
            "name_tr": t.name_tr,
            "formula": t.formula,
            "category": t.category,
            "attempts_count": attempts_count,
            "correct_count": correct_count,
        })
    return {"items": items}
@router.get("/{tense_id}")
async def get_tense(tense_id: str):
    tense = await Tense.get(tense_id)
    if not tense:
        raise HTTPException(404, "Tense not found")
    
    if not tense.ai_lesson:
        try:
            await generate_and_save_tense_lesson(tense, 5)
            # Re-fetch tense to get updated ai_lesson
            tense = await Tense.get(tense_id)
        except Exception as e:
            # We can raise an error if AI fails so the client knows
            raise HTTPException(502, f"AI ders üretimi başarısız: {e}") from e

    user_id = settings.default_user_id

    # Find IDs of exercises the user has already attempted
    attempts = await UserAttempt.find(
        UserAttempt.user_id == user_id,
        UserAttempt.tense_id == tense.id
    ).to_list()
    attempted_exercise_ids = {a.exercise_id for a in attempts if a.exercise_id}

    # Fetch all exercises for this tense
    all_exercises = await Exercise.find(Exercise.tense_id == tense.id).to_list()
    unattempted_exercises = [e for e in all_exercises if e.id not in attempted_exercise_ids]

    # If we have fewer than 5 unattempted exercises, generate more!
    if len(unattempted_exercises) < 5:
        try:
            await generate_and_save_tense_lesson(tense, 5)
            # Re-fetch and filter again
            all_exercises = await Exercise.find(Exercise.tense_id == tense.id).to_list()
            unattempted_exercises = [e for e in all_exercises if e.id not in attempted_exercise_ids]
        except Exception:
            pass

    # Sort unattempted exercises so newest are shown first, limit to 5
    unattempted_exercises.sort(key=lambda e: e.id, reverse=True)
    display_exercises = unattempted_exercises[:5]

    # Fallback to returning the latest 5 exercises if all are solved and we couldn't generate new ones
    if not display_exercises:
        all_exercises.sort(key=lambda e: e.id, reverse=True)
        display_exercises = all_exercises[:5]

    return {
        "id": str(tense.id),
        "slug": tense.slug,
        "name_en": tense.name_en,
        "name_tr": tense.name_tr,
        "formula": tense.formula,
        "description_tr": tense.description_tr,
        "examples": tense.examples,
        "ai_lesson": tense.ai_lesson,
        "exercises": [
            {
                "id": str(e.id),
                "type": e.type,
                "prompt": e.prompt,
                "options": e.options,
                "hint_tr": e.hint_tr,
            }
            for e in display_exercises
        ],
    }


@router.post("/{tense_id}/generate")
async def generate_tense_lesson(tense_id: str, body: GenerateTenseBody):
    tense = await Tense.get(tense_id)
    if not tense:
        raise HTTPException(404, "Tense not found")
    try:
        return await generate_and_save_tense_lesson(tense, body.exercise_count)
    except Exception as e:
        raise HTTPException(502, f"AI ders üretimi başarısız: {e}") from e


def normalize_contractions(text: str) -> str:
    contractions = {
        "n't": " not",
        "'m": " am",
        "'re": " are",
        "'s": " is",
        "'ve": " have",
        "'d": " would",
        "'ll": " will",
    }
    t = text.lower()
    for key, val in contractions.items():
        t = t.replace(key, val)
    return " ".join(t.split())


def check_flexible_answer(user_ans: str, correct_ans: str, prompt: str) -> bool:
    u = user_ans.strip().lower()
    c = correct_ans.strip().lower()
    p = prompt.strip().lower()
    
    # Remove trailing punctuation
    u_clean = u.rstrip(".?!,")
    c_clean = c.rstrip(".?!,")
    p_clean = p.rstrip(".?!,")
    
    # 1. Exact match (case insensitive, stripped punctuation)
    if u_clean == c_clean:
        return True
        
    # 2. Match after contraction normalization
    if normalize_contractions(u_clean) == normalize_contractions(c_clean):
        return True
        
    # 3. Handle "wrong -> correct" format in correct answer
    if "->" in correct_ans:
        parts = [part.strip().lower() for part in correct_ans.split("->")]
        if len(parts) >= 2:
            wrong_word = parts[0].rstrip(".?!,")
            right_word = parts[1].rstrip(".?!,")
            
            # User wrote only the corrected word (e.g. "seen")
            if normalize_contractions(u_clean) == normalize_contractions(right_word):
                return True
                
            # User wrote the whole sentence correcting the mistake
            # E.g. user: "He has seen that movie three times."
            # We check with word boundaries to avoid false substring matches
            wrong_norm_str = normalize_contractions(wrong_word)
            right_norm_str = normalize_contractions(right_word)
            u_norm_str = normalize_contractions(u_clean)
            
            wrong_pattern = r'\b' + re.escape(wrong_norm_str) + r'\b'
            right_pattern = r'\b' + re.escape(right_norm_str) + r'\b'
            
            if re.search(right_pattern, u_norm_str) and not re.search(wrong_pattern, u_norm_str):
                return True
                
    # 4. Correct answer is a full sentence, user wrote only the correction word
    # E.g. prompt: "He don't like pizza.", correct: "He doesn't like pizza.", user: "doesn't"
    u_norm = normalize_contractions(u_clean)
    c_norm = normalize_contractions(c_clean)
    p_norm = normalize_contractions(p_clean)
    
    if len(u_clean) > 2 and u_norm in c_norm and u_norm not in p_norm:
        return True
        
    return False


@router.post("/exercises/{exercise_id}/submit")
async def submit_exercise(exercise_id: str, body: SubmitAnswer):
    exercise = await Exercise.get(exercise_id)
    if not exercise:
        raise HTTPException(404, "Exercise not found")

    is_correct = check_flexible_answer(body.answer, exercise.answer, exercise.prompt)
    await UserAttempt(
        user_id=settings.default_user_id,
        exercise_id=exercise.id,
        source_type="tense",
        source_id=str(exercise.id),
        answer=body.answer,
        is_correct=is_correct,
        duration_ms=body.duration_ms,
        tense_id=exercise.tense_id,
    ).insert()

    if not is_correct:
        await add_to_error_pool(
            source_type="tense",
            source_id=str(exercise.id),
            prompt=exercise.prompt,
            correct_answer=exercise.answer,
            user_answer=body.answer,
        )

    return {
        "is_correct": is_correct,
        "correct_answer": exercise.answer if not is_correct else None,
    }
