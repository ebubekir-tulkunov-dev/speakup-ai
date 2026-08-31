import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.models import UserAttempt, Word
from app.services.ai_client import ai_post
from app.services.basic_words import is_basic_lemma

router = APIRouter(prefix="/practice", tags=["practice"])

SPEAK_ANGLES: dict[str, list[str]] = {
    "daily routine": [
        "akşam eve gelince yorgun ama keyifli bir saat",
        "sabah işe yetişmeye çalışırken ufak bir aksilik",
        "öğle arasında kısa bir yürüyüş",
        "gece yatmadan önce telefonu bırakıp kitap okumak",
        "yağmurlu bir günde dışarı çıkmadan evde kalmak",
        "komşuya salça isterken kısa bir sohbet",
        "çamaşır asarken balkonda beş dakika dinlenmek",
    ],
    "home and family": [
        "aile yemeğinde herkesin aynı anda konuşması",
        "kardeşle televizyon kumandası kavgası",
        "anneanne/babaanne ziyareti ve çay ikramı",
        "evde küçük bir tamirat işi",
        "çocuk/yeğenle oyun oynarken yorulmak",
        "aile WhatsApp grubunda yanlış anlaşılma",
    ],
    "shopping and food": [
        "markette kasa kuyruğunda beklemek",
        "tarife bakarak ilk kez bir yemek denemek",
        "arkadaşla kafede menüye karar verememek",
        "indirimli ürün alırken tereddüt etmek",
        "evde kalan malzemelerle pratik bir akşam yemeği",
        "sokak tezgâhından meyve alırken pazarlık",
    ],
    "work and school": [
        "toplantıya yetişmek için acele etmek",
        "ödevi son gece yetiştirmeye çalışmak",
        "iş yerinde öğle molasında kısa bir sohbet",
        "yeni bir iş/okul arkadaşını tanımak",
        "sunumdan önce hafif heyecanlanmak",
        "uzaktan çalışırken evde dikkat dağınıklığı",
    ],
    "health and feelings": [
        "hafif bir soğuk algınlığıyla güne devam etmek",
        "stresli bir günden sonra yürüyüşe çıkmak",
        "iyi haber alınca arkadaşını aramak",
        "uykusuz bir sabahın etkisi",
        "spor salonunda ilk hafta zorlanmak",
        "doktor randevusunu ertelemek istemek",
    ],
    "travel and city": [
        "otobüste yer bulamadan ayakta gitmek",
        "yeni bir semtte yol sormak",
        "tren/otogar beklerken zaman geçirmek",
        "şehir içi kısa bir gezi planı",
        "yağmurda metroya yetişmek",
        "turist gibi kendi şehrini gezmek",
    ],
    "plans and weekend": [
        "pazar günü hiçbir şey yapmamaya karar vermek",
        "arkadaşlarla sinema saati ayarlamak",
        "hafta sonu için yarım kalan işleri bitirmek",
        "piknik planı yapıp hava durumuna bakmak",
        "pazartesi için hazırlık yapmak",
        "ani bir kahve daveti kabul etmek",
    ],
}

DEFAULT_ANGLES = [
    "beklenmedik ama sıradan bir günlük olay",
    "kısa bir telefon konuşması sonrası hissettikleri",
    "yolda biriyle karşılaşmak",
    "küçük bir başarıdan sonra kendini ödüllendirmek",
    "planın bozulması ve yeni bir çözüm bulmak",
]

TENSES = ["present habitual", "present continuous", "past simple", "future"]


class LyricsBody(BaseModel):
    lyrics: str


class SubstitutionBody(BaseModel):
    base_word: str
    level: str = "B1"


class DrillDoneBody(BaseModel):
    base_word: str = ""


class SpeakPromptsBody(BaseModel):
    level: str = "A2"
    topic: str = "daily life"
    word_count: int = Field(default=80, ge=40, le=160)
    exclude_texts: list[str] = Field(default_factory=list)


class SpeakDoneBody(BaseModel):
    topic: str = ""
    word_count: int = 0


def _pick_angle(topic: str) -> str:
    key = topic.strip().lower()
    angles = SPEAK_ANGLES.get(key)
    if not angles:
        for k, vals in SPEAK_ANGLES.items():
            if k in key or key in k:
                angles = vals
                break
    if angles:
        return random.choice(angles)
    # Özel topic: doğrudan sahne rehberi olarak kullan
    cleaned = topic.strip()
    if cleaned:
        return cleaned
    return random.choice(DEFAULT_ANGLES)


@router.post("/lyrics")
async def translate_lyrics(body: LyricsBody):
    if not body.lyrics.strip():
        raise HTTPException(400, "Şarkı sözü boş olamaz")
    try:
        return await ai_post("/generate/translate-lines", {"lyrics": body.lyrics})
    except Exception as e:
        raise HTTPException(502, f"Çeviri başarısız: {e}") from e


@router.post("/substitution")
async def substitution(body: SubstitutionBody):
    if not body.base_word.strip():
        raise HTTPException(400, "Kelime boş olamaz")
    try:
        return await ai_post(
            "/generate/substitution",
            {"base_word": body.base_word, "level": body.level},
        )
    except Exception as e:
        raise HTTPException(502, f"Drill üretimi başarısız: {e}") from e


@router.post("/substitution/done")
async def substitution_done(body: DrillDoneBody):
    """Log a completed substitution drill so it counts toward streak / daily goal."""
    await UserAttempt(
        user_id=settings.default_user_id,
        source_type="substitution",
        answer=body.base_word[:200],
        is_correct=True,
    ).insert()
    return {"logged": True}


@router.post("/speak-prompts")
async def speak_prompts(body: SpeakPromptsBody):
    """Turkish prompts for oral TR→EN translation, seeded with top-frequency vocab."""
    topic = body.topic.strip()
    if not topic:
        raise HTTPException(400, "Topic boş olamaz")

    level = body.level if body.level != "ALL" else None
    query = Word.find(Word.level == level) if level else Word.find()
    words = await query.sort("-freq_zipf").limit(160).to_list()

    candidates: list[dict] = []
    for w in words:
        if is_basic_lemma(w.lemma):
            continue
        candidates.append({"lemma": w.lemma, "tr": w.translation_tr})
    random.shuffle(candidates)
    pool = candidates[:20]

    angle = _pick_angle(topic)
    tense = random.choice(TENSES)

    try:
        result = await ai_post(
            "/generate/speak-prompts",
            {
                "level": body.level,
                "topic": topic,
                "word_count": body.word_count,
                "word_pool": pool,
                "angle": angle,
                "tense": tense,
                "exclude_texts": body.exclude_texts[:5],
            },
        )
    except Exception as e:
        raise HTTPException(502, f"Metin üretimi başarısız: {e}") from e

    if not isinstance(result, dict):
        raise HTTPException(502, "AI geçerli metin üretmedi")

    text_tr = (result.get("text_tr") or "").strip()
    text_en = (result.get("text_en") or "").strip()
    if not text_tr or not text_en:
        raise HTTPException(502, "AI geçerli metin üretmedi")

    return {
        "topic_tr": result.get("topic_tr") or topic,
        "tips_tr": result.get("tips_tr") or "",
        "text_tr": text_tr,
        "text_en": text_en,
        "focus_words": result.get("focus_words") or [],
        "hint_tr": result.get("hint_tr") or "",
        "word_pool_used": len(pool),
        "angle": angle,
        "tense": tense,
    }


@router.post("/speak-prompts/done")
async def speak_prompts_done(body: SpeakDoneBody):
    """Log a completed speak-translate session for streak / daily goal."""
    await UserAttempt(
        user_id=settings.default_user_id,
        source_type="speak_translate",
        answer=f"{body.topic}:{body.word_count}"[:200],
        is_correct=True,
    ).insert()
    return {"logged": True}
