from datetime import datetime
from typing import Any, Literal

from beanie import Document, Indexed, PydanticObjectId
from pydantic import Field


class User(Document):
    user_id: Indexed(str, unique=True) = "local_user"
    native_lang: str = "tr"
    target_lang: str = "en"
    daily_goal: int = 20
    settings: dict[str, Any] = Field(default_factory=dict)

    class Settings:
        name = "users"


class Word(Document):
    lemma: Indexed(str)
    translation_tr: str
    example: str | None = None
    example_tr: str | None = None
    level: str = "A1"
    topic: str | None = None
    source: str = "seed"
    freq_zipf: float = 0.0  # usage frequency (Zipf scale, higher = more common); drives learning order
    word_type: str = "noun"  # noun, verb, adjective, adverb, phrasal_verb, preposition, conjunction
    synonyms: list[str] = Field(default_factory=list)
    antonyms: list[str] = Field(default_factory=list)
    collocations: list[str] = Field(default_factory=list)
    forms: dict[str, Any] = Field(default_factory=dict)  # verb: past/pp/gerund, adj: comparative/superlative

    class Settings:
        name = "words"


class UserWord(Document):
    user_id: Indexed(str)
    word_id: PydanticObjectId
    ease_factor: float = 2.5
    interval: int = 0
    repetitions: int = 0
    next_review_at: datetime | None = None
    mastery: int = 0

    class Settings:
        name = "user_words"
        indexes = [
            [("user_id", 1), ("next_review_at", 1)],
        ]


class Tense(Document):
    slug: Indexed(str, unique=True)
    name_en: str
    name_tr: str
    formula: str
    description_tr: str
    examples: list[dict[str, str]] = Field(default_factory=list)
    category: str = "present"
    ai_lesson: dict[str, Any] | None = None

    class Settings:
        name = "tenses"


class Exercise(Document):
    type: Literal["fill_blank", "transform", "choose_tense", "error_correction"]
    category: str = "tenses"
    tense_id: PydanticObjectId | None = None
    prompt: str
    answer: str
    options: list[str] = Field(default_factory=list)
    hint_tr: str | None = None
    source: str = "seed"

    class Settings:
        name = "exercises"


class UserAttempt(Document):
    user_id: Indexed(str)
    exercise_id: PydanticObjectId | None = None
    source_type: str
    source_id: str | None = None
    answer: str
    is_correct: bool
    duration_ms: int = 0
    tense_id: PydanticObjectId | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "user_attempts"


class ErrorPoolItem(Document):
    user_id: Indexed(str)
    source_type: str
    source_id: str
    prompt: str
    correct_answer: str
    user_answer: str | None = None
    priority: int = 1
    review_count: int = 0
    wrong_streak: int = 1
    correct_streak: int = 0
    last_seen_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "error_pool"
        indexes = [
            [("user_id", 1), ("priority", -1)],
        ]


class Scenario(Document):
    title: str
    context: str
    difficulty: str = "A2"
    target_tense_slug: str | None = None
    opening_line: str
    category: str = "general"

    class Settings:
        name = "scenarios"


class ChatSession(Document):
    user_id: Indexed(str)
    title: str = "New chat"
    scenario: str = "Free conversation"
    tense: str = "General"
    mode: str = "free"
    level: str = "B1"
    messages: list[dict] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "chat_sessions"
        indexes = [
            [("user_id", 1), ("updated_at", -1)],
            [("user_id", 1), ("scenario", 1), ("tense", 1)],
        ]


class ReadingPassage(Document):
    title: str
    content: str
    level: str = "A2"
    word_count: int = 0
    tense_focus: str | None = None
    summary_tr: str | None = None
    source: str = "seed"
    questions: list[dict[str, Any]] = Field(default_factory=list)  # cached comprehension quiz

    class Settings:
        name = "reading_passages"


class JournalEntry(Document):
    user_id: Indexed(str)
    entry_date: str  # YYYY-MM-DD
    future_text: str = ""  # tomorrow's plans (future tense)
    past_text: str = ""  # today's recap (past tense)
    corrections: list[dict[str, Any]] = Field(default_factory=list)
    feedback_tr: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "journal_entries"
        indexes = [
            [("user_id", 1), ("created_at", -1)],
        ]


class KnownWord(Document):
    user_id: Indexed(str)
    word_id: PydanticObjectId | None = None
    lemma: Indexed(str)
    mastery: int = 1
    marked_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "known_words"
        indexes = [
            [("user_id", 1), ("lemma", 1)],
        ]


class TranslationCache(Document):
    lemma: Indexed(str, unique=True)
    translation_tr: str
    translations: dict[str, str] = Field(default_factory=dict)

    class Settings:
        name = "translation_cache"


class PodcastEpisode(Document):
    user_id: Indexed(str)
    youtube_url: str
    youtube_id: str | None = None
    title: str = ""
    channel: str | None = None
    duration_sec: float | None = None
    status: Literal["pending", "downloading", "transcribing", "ready", "failed"] = "pending"
    error: str | None = None
    speaker_count: int = 0
    utterances: list[dict[str, Any]] = Field(default_factory=list)
    # each: {speaker: int, start: float, end: float, text: str}
    full_text: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "podcast_episodes"
        indexes = [
            [("user_id", 1), ("created_at", -1)],
            [("youtube_id", 1)],
        ]


class TopicSpeakQuestion(Document):
    """Oral practice: level-based open questions with voice answers + corrections."""

    user_id: Indexed(str)
    level: str = "B1"
    topic: str = ""
    question: str = ""
    question_tr: str | None = None
    hint_tr: str | None = None
    target_words: list[dict[str, Any]] = Field(default_factory=list)
    # each: {lemma, type: noun|verb|adjective|adverb, tr}
    target_patterns: list[dict[str, Any]] = Field(default_factory=list)
    # each: {pattern, example, tr} — e.g. Since + clause, + main clause
    qdrant_id: str | None = None
    transcript: str | None = None
    evaluation: dict[str, Any] | None = None
    status: Literal["asked", "answered"] = "asked"
    asked_at: datetime = Field(default_factory=datetime.utcnow)
    answered_at: datetime | None = None

    class Settings:
        name = "topic_speak_questions"
        indexes = [
            [("user_id", 1), ("asked_at", -1)],
            [("user_id", 1), ("level", 1), ("asked_at", -1)],
        ]


ALL_MODELS = [
    User,
    Word,
    UserWord,
    Tense,
    Exercise,
    UserAttempt,
    ErrorPoolItem,
    Scenario,
    ChatSession,
    ReadingPassage,
    JournalEntry,
    KnownWord,
    TranslationCache,
    PodcastEpisode,
    TopicSpeakQuestion,
]
