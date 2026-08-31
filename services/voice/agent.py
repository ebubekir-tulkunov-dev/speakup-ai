import os
import json
import asyncio
import difflib
import random
from pathlib import Path

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, inference, llm as lk_llm
from livekit.plugins import cartesia, deepgram, minimax, openai, silero
from openai import AsyncOpenAI

# CWD .env (if any) then project-root .env
load_dotenv()
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# ── Turn-taking tuning ───────────────────────────────────────────────
# (min_delay, max_delay) in seconds for endpointing. Lower-level learners pause
# mid-sentence far more often, so they get a longer grace period before the
# tutor takes the turn.
ENDPOINTING_BY_LEVEL = {
    "A1": (0.8, 4.0),
    "A2": (0.7, 3.5),
    "B1": (0.5, 3.0),
    "B2": (0.4, 2.5),
    "C1": (0.35, 2.2),
    "C2": (0.3, 2.0),
}

STT_REPAIR_ENABLED = os.getenv("STT_REPAIR", "1") != "0"
STT_REPAIR_MODEL = os.getenv("STT_REPAIR_MODEL", "gpt-4o-mini")
STT_REPAIR_TIMEOUT = float(os.getenv("STT_REPAIR_TIMEOUT", "1.6"))

# ── Level-specific teaching parameters ──────────────────────────────
LEVEL_CONFIG = {
    "A1": {
        "speed": "very slowly and clearly",
        "complexity": "Use only simple present and past tense. Max 5-7 words per sentence. Use basic vocabulary only.",
        "error_tolerance": "Be very patient. Praise every attempt. Only correct critical errors that block understanding.",
        "hints": "Give Turkish translations frequently. Offer sentence starters like 'You can say: ...'"
    },
    "A2": {
        "speed": "slowly and clearly",
        "complexity": "Use simple sentences with basic connectors (and, but, because). Max 8-10 words per sentence.",
        "error_tolerance": "Correct major grammar errors gently. Ignore minor mistakes if meaning is clear.",
        "hints": "Give Turkish hints when the student pauses for more than 3 seconds."
    },
    "B1": {
        "speed": "at a moderate pace",
        "complexity": "Use compound sentences. Introduce phrasal verbs and common idioms. 10-15 words per sentence.",
        "error_tolerance": "Correct grammar and vocabulary errors. Show the correct form naturally.",
        "hints": "Give Turkish hints only when the student clearly struggles."
    },
    "B2": {
        "speed": "at a natural conversational pace",
        "complexity": "Use complex sentences with relative clauses, conditionals, and passive voice.",
        "error_tolerance": "Correct all grammar errors. Point out nuance and register issues.",
        "hints": "Minimize Turkish. Explain in simple English first, Turkish only if needed."
    },
    "C1": {
        "speed": "at natural speed with contractions and reductions",
        "complexity": "Use advanced vocabulary, idioms, and complex structures. Include discourse markers.",
        "error_tolerance": "Correct subtle errors: collocations, preposition choices, article usage.",
        "hints": "No Turkish hints. Explain everything in English."
    },
    "C2": {
        "speed": "at full native speed",
        "complexity": "Use sophisticated vocabulary, irony, humor. Discuss abstract topics in depth.",
        "error_tolerance": "Focus on style, register, and naturalness rather than grammar.",
        "hints": "Treat as a near-native speaker. Challenge with nuance."
    },
}


# Flexible conversation modes (not rigid role-play scripts)
# Aim: sitcom-like / real-life chat — stories, reactions, specifics — not shallow preference quizzes.
CONVERSATION_MODES = {
    "Serbest sohbet": {
        "persona": "a warm friend who chats like in a casual sitcom scene",
        "style": (
            "Have a natural TWO-WAY conversation like two friends hanging out — not an interview. "
            "React to what they say with a short comment or tiny anecdote about yourself so they can ask YOU things too. "
            "Do NOT end every turn with a question. Roughly alternate: question turns and statement/story turns. "
            "When they ask you something, answer warmly with a concrete detail before anything else. "
            "TOPIC VARIETY (CRITICAL): After ~2 turns on one thread, MOVE ON. Do not recycle spilled coffee, "
            "changed shirts, chaotic mornings, or 'how was your day' forever. "
            "Rotate among different everyday threads: weekend plans, food, a show/podcast, work/school deadline, "
            "sports, travel wish, a funny stranger moment, shopping fail, weather mood, a small win, family/friends plans. "
            "When a topic feels done, bridge naturally: 'Anyway — speaking of…' / 'Random, but…' and open a NEW angle. "
            "Never reopen the same joke/prop (coffee, shirt, mess) once the student has moved on. "
            "AVOID shallow preference quizzes like 'What do you like?' as openers."
        ),
        "greeting": (
            "Greet them like a friend (Hey! / Hi!). Open with ONE fresh, specific hook — "
            "NOT spilled coffee, NOT changing shirts, NOT 'chaotic morning' (those are overused). "
            "Pick something different each session, e.g. a weird snack you tried, a show cliffhanger, "
            "a traffic delay, weekend plans that changed, a rainy walk, a deadline at work, or a funny text from a friend. "
            "Then invite them to react, ask you about it, OR share something from their side."
        ),
    },
    "mode:friend_day": {
        "persona": "a close friend catching up after the day — sitcom energy",
        "style": (
            "You are NOT a formal teacher — you are a supportive friend catching up. "
            "Share a slice of YOUR day and ask about THEIRS — real back-and-forth. "
            "Rotate topics: after a couple turns, leave the morning-story and go to evening plans, food, work, or a random side quest. "
            "Do not loop on coffee/shirt/chaos. Answer their questions with specifics. "
            "Do not end every message with a question. Still gently correct English after responding as a friend."
        ),
        "greeting": (
            "Greet them like a friend (Hey! / Hi!). Mention one concrete NEW thing from 'your' day "
            "(avoid coffee-spill / shirt / chaotic-morning clichés). Open the floor for them to react or share."
        ),
    },
    "mode:friend_casual": {
        "persona": "a casual friend chatting about everyday life",
        "style": (
            "Chat like friends: food, weekend plans, a show, last-minute plans, sports, errands. "
            "TWO-WAY. Keep switching threads every few turns — do not stay on one mishap all session. "
            "React first; only sometimes ask a follow-up. Avoid checklist interviews and coffee-shirt loops."
        ),
        "greeting": (
            "Say hi casually and open with a concrete hook that is NOT a coffee/shirt morning disaster — "
            "e.g. weekend plans, a show, a food craving, a small plan that changed."
        ),
    },
    "mode:teacher_checkin": {
        "persona": "a friendly English teacher starting a lesson check-in",
        "style": (
            "You are a patient teacher. Ask what they want to practice today "
            "(speaking, vocabulary, a tense, telling a story, asking questions in English). "
            "Then run a mini-scene that feels like real dialogue — they should both answer AND ask. "
            "Correct errors a bit more explicitly than in friend mode."
        ),
        "greeting": (
            "Greet them as their English teacher. Ask what they'd like to work on today, "
            "and offer one concrete practice idea (e.g. 'let's practice a two-way chat about something that went wrong this week')."
        ),
    },
    "mode:teacher_practice": {
        "persona": "an English teacher running flexible dialogue practice",
        "style": (
            "Practice REAL dialogue, not one-way Q&A. You may ask a concrete question, but also "
            "share a short answer/opinion of your own so the student can ask YOU something. "
            "When they only answer, occasionally nudge: 'You can ask me something too if you want.' "
            "One question max when you ask. Aim for sitcom-length turns from the student."
        ),
        "greeting": (
            "Greet them as their teacher and start a two-way warm-up: share one tiny concrete detail, "
            "then invite them to react or ask you about it — not only 'What do you like?'."
        ),
    },
    "mode:opinion": {
        "persona": "a curious conversation partner who likes exchanging opinions",
        "style": (
            "Exchange opinions both ways: share YOUR take first sometimes, then hear theirs. "
            "Agree or politely disagree. Invite elaboration — and welcome their questions to you. "
            "Do not monopolize with interview questions. Keep it conversational, not a debate club."
        ),
        "greeting": (
            "Greet them, share a quick opinion hook of your own "
            "(e.g. working from cafés, late-night scrolling), and invite them to react or ask why you think that."
        ),
    },
    "mode:interview": {
        "persona": "a friendly interviewer in a flexible job interview practice",
        "style": (
            "Run a realistic but flexible interview: introduce yourself briefly, ask common questions "
            "(background, strengths, teamwork, a challenge) and dig into STAR-style details. "
            "React to answers naturally — not a rigid script. Push for longer, specific stories. "
            "Give brief tips on clearer phrasing when helpful."
        ),
        "greeting": "Welcome them to a practice interview and ask them to introduce themselves briefly with a recent example of their work.",
    },
    "mode:vocab_practice": {
        "persona": "a supportive teacher running vocabulary speaking practice",
        "style": (
            "This session is VOCABULARY SPEAKING PRACTICE. "
            "Ask short situational / story questions that invite the student to USE words from their learned list. "
            "Do NOT ask dictionary questions like 'What does X mean?'. "
            "Instead: 'Tell me about a time when you felt exhausted' if 'exhausted' is a target word. "
            "After they answer, briefly praise if they used a target word, or gently nudge them to try one. "
            "Rotate different target words across turns. Keep it conversational and story-based, not a quiz."
        ),
        "greeting": (
            "Greet them briefly as their vocab practice partner. "
            "Pick 1–2 words from their learned vocabulary list, say them clearly, "
            "and ask one situational / story question that invites them to use those words in a longer answer."
        ),
    },
    "mode:scenario_coach": {
        "persona": "a supportive English speaking coach guiding the student through a specific scenario",
        "style": (
            "This is SCENARIO-BASED SPEAKING COACHING. You have a scenario description, "
            "a target grammar tense, and a list of target vocabulary words. Your job is to: "
            "1. Guide the conversation to stay within the scenario — make it feel like a real scene (sitcom beat), not a quiz. "
            "2. Ask questions that naturally prompt the student to use the TARGET TENSE. "
            "   For example, if the target is Past Simple, ask 'What did you do then?' or 'What happened next?'. "
            "3. When the student hasn't used a target word yet, STEER the conversation toward topics "
            "   where that word would naturally appear. Don't say 'use the word X' — instead ask "
            "   a question that makes the word useful. For example, if 'argue' is unused, ask "
            "   'Did you and your friend disagree about anything?'. "
            "4. When the student successfully uses a target word, give brief praise (nice use of 'argue'!). "
            "5. Keep your responses SHORT (2-3 sentences max) but ask for STORIES from the student. "
            "5b. Make it TWO-WAY when natural: share a short coach/partner line so the student can ask you something too; "
            "do not end every turn with a question. "
            "6. Stay in the scenario — don't wander to random topics. "
            "7. Be warm and encouraging. Correct grammar naturally (recast, don't lecture)."
        ),
        "greeting": (
            "Set the scene for the scenario briefly and naturally — like the opening beat of a sitcom scene. "
            "Invite the student to start talking (and make it clear they can ask you things too)."
        ),
    },
}


def _vocab_block(vocab_words: list | None, *, force: bool = False) -> str:
    if not vocab_words:
        if force:
            return """
## LEARNED VOCABULARY
No practiced words yet. Have a normal conversation and introduce useful everyday words gently.
"""
        return ""

    lines = []
    for w in vocab_words[:20]:
        lemma = w.get("lemma") or w.get("l") or ""
        tr = w.get("tr") or w.get("translation_tr") or ""
        if lemma:
            lines.append(f"- {lemma}" + (f" — {tr}" if tr else ""))

    word_list = "\n".join(lines) if lines else "- (empty)"
    intensity = (
        "PRIORITY: Build almost every question around these words. The student should try to use them when answering."
        if force
        else "When natural, weave 1 target word into a question so the student can practice it."
    )
    return f"""
## STUDENT'S LEARNED VOCABULARY (from their flashcards)
{word_list}

{intensity}
- Prefer situational questions over definitions
- If they use a target word correctly, praise it in one short phrase
- If they avoid it, nudge once: "Try using the word 'X' in your next sentence"
- Rotate words; don't repeat the same target every turn
"""


def _scenario_coach_block(scenario_config: dict) -> str:
    """Build prompt section for scenario coaching mode."""
    desc = scenario_config.get("description_tr", "")
    tense = scenario_config.get("target_tense", "")
    tense_example = scenario_config.get("target_tense_example", "")
    target_words = scenario_config.get("target_words", [])

    word_lines = []
    for w in target_words:
        lemma = w.get("lemma", "")
        tr = w.get("tr", "")
        if lemma:
            word_lines.append(f"- {lemma} ({tr})")
    word_list = "\n".join(word_lines) if word_lines else "- (no specific words)"

    if tense.lower() in ("mixed", "karışık", "karışık (mixed)", "mixed (karışık - serbest)"):
        tense_instruction = (
            "The conversation has NO target tense. The student can use any grammatical tense freely. "
            "Ask natural conversational questions matching the scenario without forcing any specific tense."
        )
    else:
        tense_instruction = f"""The student MUST practice using: **{tense}**
Example: "{tense_example}"

Your questions should naturally elicit this tense. For example:
- Past Simple → "What did you do?", "What happened?"
- Present Perfect → "Have you ever...?", "How long have you...?"
- Future → "What are you going to do?", "What will you...?"
- Modals → "What should you do?", "What could happen?" """

    return f"""
## SCENARIO COACHING SESSION
Scenario (Turkish description for context): {desc}

## TARGET GRAMMAR TENSE / FOCUS
{tense_instruction}

## TARGET VOCABULARY WORDS
The student should try to use these words during the conversation:
{word_list}

STRATEGY for unused words:
- Do NOT say "please use the word X" — that's unnatural
- Instead, steer the topic so the word becomes useful
- Example: if 'argue' is unused, ask "Did you two disagree about anything?"
- When they use a target word, give brief praise: "Nice use of 'argue'!"
- Rotate through unused words across turns
"""


def build_system_prompt(level: str, scenario: str, vocab_words: list | None = None,
                        scenario_config: dict | None = None) -> str:
    """Build a level-adaptive, pedagogically rich system prompt."""
    config = LEVEL_CONFIG.get(level, LEVEL_CONFIG["B1"])
    mode = CONVERSATION_MODES.get(scenario)
    force_vocab = scenario == "mode:vocab_practice"
    is_coaching = scenario == "mode:scenario_coach" and scenario_config

    if is_coaching:
        topic_block = f"""## YOUR ROLE
You are {CONVERSATION_MODES['mode:scenario_coach']['persona']}.

## CONVERSATION STYLE
{CONVERSATION_MODES['mode:scenario_coach']['style']}"""
    elif mode:
        topic_block = f"""## YOUR ROLE
You are {mode['persona']}.

## CONVERSATION STYLE
{mode['style']}"""
    else:
        topic_block = f"""## CONVERSATION TOPIC
The current scenario/topic is: "{scenario}"
Stay in character for this role-play scenario. Set the scene briefly at the start, then keep the conversation flexible — do not force a fixed script."""

    vocab_section = _vocab_block(vocab_words, force=force_vocab)
    coaching_section = _scenario_coach_block(scenario_config) if is_coaching else ""

    return f"""You are an expert English conversation tutor for a Turkish-speaking learner at CEFR {level} level.

## YOUR PERSONALITY
- Warm, encouraging, and patient
- Natural and conversational — never robotic
- Use the student's name if known, otherwise say "my friend"

## SPEECH RULES
- Speak {config['speed']}
- {config['complexity']}
- Keep your responses to 2-3 sentences maximum
- NEVER use Turkish unless giving a hint (see below)

{topic_block}
{coaching_section}
{vocab_section}
## ERROR CORRECTION (CRITICAL)
When the student makes a grammar, vocabulary, or pronunciation error:
1. FIRST: Respond naturally to what they said (show you understood their meaning)
2. THEN: Gently correct by recasting. Say something like:
   - "By the way, we usually say '[correct form]' instead of '[wrong form]'"
   - "Just a small note: '[correct form]' sounds more natural here"
   - "Great point! And the correct way to say that is: '[correct form]'"
3. NEVER just repeat the error without correction
4. NEVER be harsh or discouraging
5. NEVER "correct" a phrase into a DIFFERENT topic. Example of a BAD correction:
   student said "going through play" (likely meant playing guitar/an instrument) and you
   rewrite it as "going to plays" (theatre). That hijacks the conversation. If meaning is
   unclear, ask — do not invent a polished sentence that changes what they meant.

## WHEN THE TRANSCRIPT DOESN'T MAKE SENSE (CRITICAL)
The student's words reach you through speech recognition, so words are often garbled —
especially for Turkish speakers (made/met, theatre/trade, comedies/comedians, playing/play).
- If a sentence is awkward, incomplete, or a word has TWO plausible meanings
  (e.g. "play" = music instrument vs theatre), do NOT pick one and run with it
- Ask a short clarifying question with the alternatives:
  "Sorry — did you mean you started playing guitar, or going to theatre plays?"
- Do NOT build the next few turns on a guess. One wrong guess (guitar → Shakespeare)
  ruins the whole chat
- Only treat something as a grammar error when you are confident of their intended meaning

## SCAFFOLDING
- If the student gives very short answers (1-3 words), ask a follow-up that invites a mini-story or concrete detail
- If the student pauses for a long time, offer a sentence starter: "You could say something like: '...'"
- {config['hints']}

## NATURAL DIALOGUE (CRITICAL — two-way chat, not an interview)
- This must feel like a REAL conversation between two people — NOT a quiz where only YOU ask and the student only answers
- Share short bits about YOUR (fictional) day/opinions so the student has something to react to and ask about
- Roughly alternate energy: sometimes YOU ask; sometimes YOU answer and leave space for THEM to ask
- About every other turn, end WITHOUT a question — a reaction, a tiny story, or "Yeah..." that invites them to continue or ask you something
- When the student asks YOU a question: answer it fully first (1–2 sentences), THEN optionally add one soft follow-up — never dodge their question to re-interview them
- Prefer concrete situations (what happened next, who was there, how it felt)
- AVOID shallow loops: "What do you like?", "What are your hobbies?" unless the student brings it up
- When you do ask, ask ONE question max per turn — never stack questions
- Aim for the student to produce longer turns (2+ sentences). Nudge gently when answers are too short
- Encourage curiosity: praise briefly when they ask you something ("Good question!") and give a real answer

## TOPIC VARIETY (CRITICAL — do not get stuck)
- Do NOT stay on the same topic for the whole session
- After about 2 exchanges on one thread, pivot to a NEW related or fresh topic with a natural bridge
- Banned as session-long loops (OK once, then drop): spilled coffee, changing shirts, "chaotic morning", mismatched socks
- Prefer rotating themes: food, weekend, work/school, entertainment, travel wish, sports, errands, weather mood, small wins, plans with friends
- If you notice you already used coffee/shirt/mess this session, deliberately pick something else
- Follow the student's lead when they change topic — do not drag them back to your opening anecdote

## VOCABULARY TEACHING
- When you use a word that might be new for a {level} student, briefly explain it
- For A1-A2: Include the Turkish translation in parentheses
- For B1+: Explain using simpler English synonyms

## WHAT NOT TO DO
- Don't lecture or give long grammar explanations during conversation
- Don't switch to Turkish entirely
- Don't ask too many questions in a row
- Don't turn every reply into another interview question
- Don't be robotic — be natural and conversational
- Don't stick to a rigid script — stay flexible and follow the student
- Don't keep the chat stuck on vague likes/dislikes — move into stories and specifics
- Don't recycle the same opening story (coffee / shirt / chaos) across turns or sessions"""


def greeting_for_scenario(level: str, scenario: str, vocab_words: list | None = None,
                          scenario_config: dict | None = None) -> str:
    speed = LEVEL_CONFIG.get(level, LEVEL_CONFIG["B1"])["speed"]
    mode = CONVERSATION_MODES.get(scenario)

    if scenario == "mode:scenario_coach" and scenario_config:
        desc = scenario_config.get("description_tr", "a conversation scenario")
        tense = scenario_config.get("target_tense", "")
        if tense.lower() in ("mixed", "karışık", "karışık (mixed)", "mixed (karışık - serbest)"):
            return (
                f"You are starting a scenario coaching session. The scenario is: '{desc}'. "
                f"There is no target tense constraint for this conversation. Set the scene naturally in 1-2 sentences, "
                f"then ask the first open question that invites the student to start talking about the scenario in any tense. "
                f"Speak {speed}."
            )
        return (
            f"You are starting a scenario coaching session. The scenario is: '{desc}'. "
            f"The target tense is {tense}. Set the scene naturally in 1-2 sentences, "
            f"then ask the first question that invites the student to speak using {tense}. "
            f"Speak {speed}."
        )

    if scenario == "mode:vocab_practice":
        samples = []
        for w in (vocab_words or [])[:4]:
            lemma = w.get("lemma") or w.get("l")
            if lemma:
                samples.append(lemma)
        sample_hint = ", ".join(samples) if samples else "any useful everyday words"
        return (
            f"Greet them briefly for vocabulary speaking practice. "
            f"Mention 1–2 target words from this list ({sample_hint}), "
            f"then ask one situational question that invites them to use those words. Speak {speed}."
        )
    if mode:
        # Free chat: force variety at greeting time so sessions don't all start with coffee/chaos
        if scenario == "Serbest sohbet":
            hooks = [
                "a show cliffhanger you can't stop thinking about",
                "a weird snack or meal you tried today",
                "weekend plans that suddenly changed",
                "a rainy walk or nice weather moment",
                "a small win at work or school",
                "a funny text from a friend",
                "a traffic or metro delay (without coffee-spill drama)",
                "a song stuck in your head",
            ]
            hook = random.choice(hooks)
            return (
                f"Greet them like a friend (Hey! / Hi!). Open with this specific hook: {hook}. "
                f"Do NOT mention spilled coffee, changing shirts, or chaotic mornings. "
                f"Invite them to react, ask you about it, or share something else. Speak {speed}."
            )
        return f"{mode['greeting']} Speak {speed}."
    return (
        f"Greet the student warmly in English and set the scene for the '{scenario}' role-play. "
        f"Stay in character but keep it flexible. Speak {speed}."  
    )


def build_keyterms(vocab_words: list | None, scenario_config: dict | None) -> list[str]:
    """Words to bias the recognizer toward: whatever this session is about."""
    terms: list[str] = []
    seen: set[str] = set()
    sources = [(scenario_config or {}).get("target_words") or [], vocab_words or []]
    for source in sources:
        for w in source:
            if not isinstance(w, dict):
                continue
            lemma = (w.get("lemma") or w.get("l") or "").strip()
            if lemma and lemma.lower() not in seen:
                seen.add(lemma.lower())
                terms.append(lemma)
    return terms[:80]  # Deepgram caps keyterm prompting at 100


STT_REPAIR_SYSTEM = """You proofread speech-to-text output for a Turkish speaker practising English.
Your only job is to undo recognizer errors — words the microphone got wrong.

Answer with exactly OK if the transcript is usable as it is.
Otherwise answer with the repaired sentence and nothing else.

Replace a word ONLY when it is impossible in context AND a similar-sounding word makes the
sentence make sense (made/met, launch/lunch, live/leave, thirty/thirteen, theatre/trade,
comedies/comedians). When in doubt, OK.

Never touch the learner's own English. Their wrong tense, missing article, wrong preposition,
wrong plural and odd word order must survive untouched — the tutor grades those.
Never rephrase, never tidy up, never add words that were not heard.
Never "fix" an ambiguous word into a new topic (do not turn music "play" into theatre "plays").

If the only change you would make is one of these, answer OK instead:
- a verb form or tense (watching -> watch, sing -> sang, go -> went, is -> are)
- an article (a -> an, or adding "the")
- a plural (company -> companies)
- a preposition (in -> at)
- word order

Examples:
"I met application to three company last week" -> I made application to three company last week
    (met/made misheard; "three company" is the learner's error and stays)
"I go to school yesterday and I meet my friend" -> OK
    (wrong tense, but that is the learner's mistake, not the recognizer's)
"I am very tired because I work hard" -> OK
    (nothing is nonsensical)
"I like to sing song in the tree" -> OK
    (odd, but understandable — do not guess)
"I want to lunch a new project with my brother" -> I want to launch a new project with my brother
    ("lunch a project" is impossible; launch is the obvious word)
"I usually watching movies and drink tea" -> OK
    (only the verb form is off, so it belongs to the learner)
"community trade group that stage Shakespeare comedians" -> community theatre group that stage Shakespeare comedies
    (trade/theatre and comedians/comedies are classic mishears; leave "stage" uninflected)
"I have started going through play" -> OK
    (ambiguous — music vs theatre — leave it; the tutor will ask)"""


# Two forms of the same verb must never be swapped for one another — that would be the
# repair silently fixing the learner's grammar. Different verbs (met/made) are fair game.
_IRREGULAR_FORMS = {
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be", "been": "be",
    "has": "have", "had": "have", "does": "do", "did": "do", "done": "do",
    "go": "go", "goes": "go", "went": "go", "gone": "go",
    "made": "make", "met": "meet", "say": "say", "says": "say", "said": "say",
    "took": "take", "taken": "take", "came": "come", "saw": "see", "seen": "see",
    "got": "get", "gotten": "get", "gave": "give", "given": "give", "knew": "know",
    "known": "know", "thought": "think", "found": "find", "told": "tell", "felt": "feel",
    "left": "leave", "kept": "keep", "brought": "bring", "bought": "buy", "caught": "catch",
    "taught": "teach", "wrote": "write", "written": "write", "spoke": "speak",
    "spoken": "speak", "ate": "eat", "eaten": "eat", "sang": "sing", "sung": "sing",
    "ran": "run", "began": "begin", "begun": "begin", "drank": "drink", "drunk": "drink",
    "drove": "drive", "driven": "drive", "chose": "choose", "chosen": "choose",
    "paid": "pay", "sent": "send", "spent": "spend", "lost": "lose", "won": "win",
    "read": "read", "put": "put", "let": "let", "slept": "sleep", "stood": "stand",
    "understood": "understand", "children": "child", "people": "person", "men": "man",
    "women": "woman",
}

_FUNCTION_WORDS = {"a", "an", "the", "to", "of", "in", "on", "at", "is", "are", "do", "does"}


def _stem(word: str) -> str:
    """Crude stem, good enough to tell two forms of one word apart."""
    w = _IRREGULAR_FORMS.get(word.lower().strip(".,!?;:\"'"), word.lower().strip(".,!?;:\"'"))
    for suffix, replacement in (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", "")):
        if w.endswith(suffix) and len(w) - len(suffix) >= 3:
            w = w[: -len(suffix)] + replacement
            break
    # drop a silent -e so argue/argued and live/lived collapse together
    return w[:-1] if w.endswith("e") and len(w) > 3 else w


def keep_learner_grammar(raw: str, fixed: str) -> str:
    """Undo any part of the repair that only re-conjugated or re-articled the learner."""
    a, b = raw.split(), fixed.split()
    matcher = difflib.SequenceMatcher(a=[w.lower() for w in a], b=[w.lower() for w in b])
    out: list[str] = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            out.extend(a[i1:i2])
        elif op == "replace" and (i2 - i1) == (j2 - j1):
            # word-for-word swap: keep the original wherever it is the same word re-inflected
            out.extend(
                a[i1 + k] if _stem(a[i1 + k]) == _stem(b[j1 + k]) else b[j1 + k]
                for k in range(i2 - i1)
            )
        elif op == "insert" and all(w.lower() in _FUNCTION_WORDS for w in b[j1:j2]):
            continue  # the repair added an article the learner never said
        elif op == "delete" and all(w.lower() in _FUNCTION_WORDS for w in a[i1:i2]):
            out.extend(a[i1:i2])  # the learner did say it, even if it was wrong
        else:
            out.extend(b[j1:j2])
    return " ".join(out)


def build_tts(provider: str = "cartesia"):
    if provider == "minimax":
        return minimax.TTS(
            model=os.getenv("MINIMAX_MODEL", "speech-2.6-turbo"),
            voice=os.getenv("MINIMAX_VOICE_ID", ""),
        )
    return cartesia.TTS(
        model=os.getenv("CARTESIA_MODEL", "sonic-3.5"),
        voice=os.getenv("CARTESIA_VOICE_ID", ""),
    )


class EnglishTutor(Agent):
    def __init__(self, instructions: str, repair=None) -> None:
        super().__init__(instructions=instructions)
        self._repair = repair

    async def on_user_turn_completed(
        self, turn_ctx: lk_llm.ChatContext, new_message: lk_llm.ChatMessage
    ) -> None:
        """Repair obvious misrecognitions before the tutor (and the analyzer) see them."""
        if self._repair is None:
            return
        raw = (new_message.text_content or "").strip()
        fixed = await self._repair(raw)
        if fixed and fixed != raw:
            new_message.content = [fixed]


def prewarm(proc: JobProcess):
    """Load the VAD once per worker process instead of once per conversation."""
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.05,
        min_silence_duration=0.4,
        activation_threshold=0.5,
    )


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    # Wait for remote participant to join
    for _ in range(10):
        if ctx.room.remote_participants:
            break
        await asyncio.sleep(0.1)

    student = next(iter(ctx.room.remote_participants.values()), None)
    level = "B1"
    scenario = "Serbest sohbet"
    tts_provider = "cartesia"
    vocab_words: list = []
    scenario_config: dict | None = None
    is_scenario_coach = False
    suggestions_tr = True  # bilingual reply chips (EN speak + TR meaning)
    turn_mode = "manual"  # "manual" = student presses Send; "auto" = silence ends turn
    if student and student.metadata:
        try:
            meta = json.loads(student.metadata)
            level = meta.get("level", "B1")
            scenario = meta.get("scenario", "Serbest sohbet")
            tts_provider = meta.get("tts_provider", "cartesia")
            vocab_words = meta.get("vocab_words") or []
            is_scenario_coach = meta.get("scenario_mode", False)
            scenario_config = meta.get("scenario_config")
            suggestions_tr = bool(meta.get("suggestions_tr", True))
            turn_mode = meta.get("turn_mode") or "manual"
            if turn_mode not in ("manual", "auto"):
                turn_mode = "manual"
            if is_scenario_coach:
                scenario = "mode:scenario_coach"
            print(
                f"✅ Student profile: Level={level}, Scenario={scenario}, "
                f"TTS={tts_provider}, Vocab={len(vocab_words)}, "
                f"ScenarioCoach={is_scenario_coach}, SuggestionsTR={suggestions_tr}, "
                f"TurnMode={turn_mode}"
            )
        except Exception as e:
            print(f"⚠️ Error parsing student metadata: {e}")

    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    # Reply suggestions: Qwen via DashScope (thinking OFF) — not Groq
    dashscope_key = (os.getenv("DASHSCOPE_API_KEY") or "").strip().strip('"').strip("'")
    dashscope_base = (
        os.getenv("DASHSCOPE_API_BASE")
        or "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    ).strip().strip('"').strip("'")
    qwen_model = (os.getenv("QWEN_MODEL") or "qwen3.5-flash").strip().strip('"').strip("'")
    if dashscope_key:
        print(f"🚀 Using Qwen for suggestions (thinking off). Model: {qwen_model}")
        qwen_client = AsyncOpenAI(api_key=dashscope_key, base_url=dashscope_base)
    else:
        qwen_client = None
        print("⚠️ DASHSCOPE_API_KEY missing — suggestions fall back to gpt-4o-mini")

    user_transcript = ""      # authoritative text of the turn the tutor answered
    raw_user_transcript = ""  # what Deepgram heard, before repair
    turn_display = ""         # accumulated live text for the current turn
    conversation_history: list[dict] = []
    conversation_corrections = []  # Track all corrections in the session
    conversation_new_words = []  # Track all new words taught
    message_count = 0

    stt_kwargs = {
        "model": "nova-3",
        "language": "en-US",
        "punctuate": True,
        "smart_format": True,
        # filler words ("uh", "um") are noise to read but they tell the turn
        # detector the student is still thinking, so keep them
        "filler_words": True,
    }
    keyterms = build_keyterms(vocab_words, scenario_config)
    if keyterms:
        stt_kwargs["keyterm"] = keyterms
        print(f"🔤 Deepgram keyterm biasing on {len(keyterms)} words")

    # Semantic end-of-turn detection (auto mode only). v1-mini runs in-process;
    # the v1 default would try to reach LiveKit Cloud inference.
    turn_detector = None
    if turn_mode == "auto":
        try:
            turn_detector = inference.TurnDetector(version="v1-mini")
        except Exception as e:
            print(f"⚠️ Turn detector unavailable, falling back to VAD only: {e}")

    min_delay, max_delay = ENDPOINTING_BY_LEVEL.get(level, ENDPOINTING_BY_LEVEL["B1"])
    if turn_mode == "manual":
        # Student presses "Gönder" — do not auto-end on silence
        turn_handling: dict = {
            "turn_detection": "manual",
            "interruption": {
                "min_duration": 0.8,
                "min_words": 3,
                "resume_false_interruption": True,
                "false_interruption_timeout": 2.0,
            },
        }
        print("🖱️ Manual turn mode: waiting for end_turn RPC before replying")
    else:
        turn_handling = {
            "endpointing": {"mode": "fixed", "min_delay": min_delay, "max_delay": max_delay},
            "interruption": {
                "min_duration": 0.6,
                "min_words": 2,
                "resume_false_interruption": True,
                "false_interruption_timeout": 2.0,
            },
        }
        if turn_detector is not None:
            turn_handling["turn_detection"] = turn_detector

    session = AgentSession(
        stt=deepgram.STT(**stt_kwargs),
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=build_tts(tts_provider),
        vad=ctx.proc.userdata.get("vad")
        or silero.VAD.load(
            min_speech_duration=0.05,
            min_silence_duration=0.4,
            activation_threshold=0.5,
        ),
        turn_handling=turn_handling,
    )

    def extract_text(content) -> str:
        if isinstance(content, list):
            text = ""
            for block in content:
                if isinstance(block, str):
                    text += block
                elif isinstance(block, dict):
                    text += block.get("text", "")
                elif hasattr(block, "text"):
                    text += block.text
                else:
                    text += str(block)
            return text
        elif isinstance(content, str):
            return content
        elif hasattr(content, "text"):
            return content.text
        return str(content) if content else ""

    def merge_turn_text(existing: str, new: str) -> str:
        """Keep the longest / most complete transcript; append new finals."""
        new = (new or "").strip()
        existing = (existing or "").strip()
        if not new:
            return existing
        if not existing:
            return new
        # One contains the other → keep longer
        if new.lower() in existing.lower():
            return existing
        if existing.lower() in new.lower():
            return new
        return f"{existing} {new}".strip()

    async def publish_data(payload: dict):
        """Safely publish JSON data to the room."""
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps(payload).encode("utf-8"),
                reliable=True
            )
        except Exception as e:
            print(f"⚠️ Error publishing data: {e}")

    async def repair_transcript(raw: str) -> str:
        """Undo obvious misrecognitions while keeping the learner's own errors intact."""
        nonlocal raw_user_transcript

        text = (raw or "").strip()
        raw_user_transcript = text
        # Short utterances ("yes", "thank you") are rarely misheard and not worth the latency
        if not STT_REPAIR_ENABLED or len(text.split()) < 3:
            return text

        last_agent_line = next(
            (m["text"] for m in reversed(conversation_history) if m["role"] == "assistant"),
            "",
        )
        context = f"The tutor just said: \"{last_agent_line}\"\n\n" if last_agent_line else ""

        try:
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=STT_REPAIR_MODEL,
                    messages=[
                        {"role": "system", "content": STT_REPAIR_SYSTEM},
                        {"role": "user", "content": f"{context}The recognizer produced: \"{text}\""},
                    ],
                    max_tokens=120,
                    temperature=0,
                ),
                timeout=STT_REPAIR_TIMEOUT,
            )
        except Exception as e:
            print(f"⚠️ Transcript repair skipped: {e}")
            return text

        fixed = (response.choices[0].message.content or "").strip().strip('"').strip()
        if not fixed or fixed.rstrip(".").upper() == "OK":
            return text
        # A repair swaps a word or two; a different length means the model answered the
        # student instead of proofreading them
        if not 0.8 <= len(fixed.split()) / max(1, len(text.split())) <= 1.25:
            return text
        fixed = keep_learner_grammar(text, fixed)

        if fixed != text:
            print(f"🔧 STT repair: {text!r} → {fixed!r}")
            await publish_data({
                "type": "user_transcript",
                "text": fixed,
                "raw_text": text,
                "repaired": True,
                "is_final": True,
            })
        return fixed

    async def analyze_and_send_feedback(agent_response: str, student_text: str):
        """
        Analyze the student's utterance for grammar errors, extract new words,
        and send structured feedback + suggestions to the UI.
        Also handles scenario coaching analysis (word usage + tense check).
        """
        nonlocal conversation_corrections, conversation_new_words, conversation_history

        # Update history
        if student_text and student_text.strip():
            conversation_history.append({"role": "user", "text": student_text.strip()})
        if agent_response and agent_response.strip():
            conversation_history.append({"role": "assistant", "text": agent_response.strip()})

        # 1. Send the agent response text immediately
        await publish_data({
            "type": "agent_response",
            "agent_response": agent_response,
            "user_transcript": student_text,
            "user_transcript_raw": raw_user_transcript if raw_user_transcript != student_text else "",
        })

        # 2. Analyze grammar errors and extract new words (parallel)
        latest_new_words: list = []
        # Build scenario coaching extension if active
        scenario_analysis_ext = ""
        if is_scenario_coach and scenario_config:
            target_words = scenario_config.get("target_words", [])
            target_tense = scenario_config.get("target_tense", "")
            word_list = ", ".join(w.get("lemma", "") for w in target_words)
            
            if target_tense.lower() in ("mixed", "karışık", "karışık (mixed)", "mixed (karışık - serbest)"):
                tense_check_instruction = (
                    f"- Target tense: {target_tense} (Free conversational mode. 'scenario_tense_correct' should always be true, and 'scenario_tense_attempts' should count any grammatically correct clause/sentence the student spoke)."
                )
            else:
                tense_check_instruction = (
                    f"- Target tense: {target_tense}\n"
                    f"  'scenario_tense_correct': true/false (did the student use the target tense at least once correctly?),\n"
                    f"  'scenario_tense_attempts': number (how many clauses/sentences attempted the target tense)"
                )

            scenario_analysis_ext = f"""

Also analyze for scenario coaching:
- Target words to check: [{word_list}]
{tense_check_instruction}

Add these fields to your JSON:
  "scenario_word_matches": ["list of target words (base form) the student used — include morphological variants like 'argued' for 'argue', 'went' for 'go', etc."],
  "scenario_tense_correct": true/false,
  "scenario_tense_attempts": number"""

        analysis_prompt = f"""Analyze this English sentence from a {level}-level Turkish student.

Student said: "{student_text}"
Teacher responded: "{agent_response}"

Return a JSON object with:
{{
  "corrections": [
    {{
      "wrong": "the exact wrong phrase",
      "correct": "the corrected version",
      "rule": "grammar rule name (e.g. Past Simple, Articles, Subject-Verb Agreement)",
      "explanation_tr": "brief explanation in Turkish"
    }}
  ],
  "new_words": [
    {{
      "word": "a potentially new word used by teacher",
      "meaning_tr": "Turkish meaning",
      "example": "short example sentence"
    }}
  ],
  "fluency_note": "one-line fluency observation in Turkish (e.g., 'Cümle kuruluşu iyi ama zaman ekleri karıştırılıyor')"
}}
{scenario_analysis_ext}

Rules:
- The student's text comes from speech recognition, so it can contain misheard words.
  If a "mistake" looks like a transcription artifact (a homophone, a swallowed article,
  a nonsense word) rather than something the student would actually say, leave it out.
  A wrong correction is far worse than a missed one.
- NEVER invent a correction that changes the topic or meaning
  (e.g. do NOT turn "going through play" into "going to plays" — that is a different idea)
- Only include REAL errors, not stylistic preferences
- For A1-A2 students, focus on basic tense and word order errors
- For B2+ students, include subtle errors like collocations and articles
- new_words: include 0-2 words from the teacher's response that a {level} student might not know
- If there are NO errors, return empty corrections array
- Return ONLY valid JSON, no markdown"""

        try:
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a precise English grammar analyzer. Return only valid JSON."},
                    {"role": "user", "content": analysis_prompt}
                ],
                max_tokens=700,
                temperature=0.3
            )
            content = response.choices[0].message.content.strip()
            if "```" in content:
                content = content.replace("```json", "").replace("```", "").strip()
            analysis = json.loads(content)

            corrections = analysis.get("corrections", [])
            latest_new_words = analysis.get("new_words", []) or []
            fluency_note = analysis.get("fluency_note", "")

            # Track across session
            conversation_corrections.extend(corrections)
            conversation_new_words.extend(latest_new_words)

            # 3. Send grammar feedback
            if corrections or latest_new_words or fluency_note:
                await publish_data({
                    "type": "agent_feedback",
                    "corrections": corrections,
                    "new_words": latest_new_words,
                    "fluency_note": fluency_note,
                    "total_errors": len(conversation_corrections),
                    "total_words_learned": len(conversation_new_words),
                    "message_index": message_count
                })

            # 4. Send scenario coaching feedback if applicable
            if is_scenario_coach:
                word_matches = analysis.get("scenario_word_matches", [])
                tense_correct = analysis.get("scenario_tense_correct", False)
                tense_attempts = analysis.get("scenario_tense_attempts", 0)
                await publish_data({
                    "type": "scenario_feedback",
                    "word_matches": word_matches,
                    "tense_correct": tense_correct,
                    "tense_attempts": tense_attempts,
                })

        except Exception as e:
            print(f"⚠️ Error in grammar analysis: {e}")

        # 5. Generate response suggestions tailored to the student's level
        try:
            last_teacher = (agent_response or "").strip()
            # Recent vocab chips shown in the UI (prefer this turn, else last few from session)
            practice_words = latest_new_words or conversation_new_words[-4:]
            practice_words_lines = []
            seen_w: set[str] = set()
            for w in practice_words:
                if not isinstance(w, dict):
                    continue
                lemma = (w.get("word") or w.get("lemma") or "").strip()
                if not lemma or lemma.lower() in seen_w:
                    continue
                seen_w.add(lemma.lower())
                meaning = (w.get("meaning_tr") or w.get("tr") or "").strip()
                practice_words_lines.append(f"- {lemma}" + (f" ({meaning})" if meaning else ""))
            practice_words_block = "\n".join(practice_words_lines[:4])

            if level in ("A1", "A2"):
                rules = "complete answers of about 8-16 English words; simple but not one-word replies"
                max_tok = 160
            elif level in ("B1", "B2"):
                rules = "rich answers of about 18-35 English words; 1-2 connected sentences with details and connectors"
                max_tok = 320
            else:  # C1, C2
                rules = "advanced answers of about 25-45 English words; natural multi-clause replies with nuance"
                max_tok = 420

            # Include scenario coaching target words and tense in suggestion instructions if applicable
            target_words_prompt = ""
            if is_scenario_coach and scenario_config:
                target_words_list = [w.get("lemma", "") for w in scenario_config.get("target_words", []) if w.get("lemma")]
                target_tense = scenario_config.get("target_tense", "")
                parts = []
                if target_words_list:
                    words_str = ", ".join(target_words_list)
                    parts.append(
                        f"Scenario target vocabulary (optional, only where natural): [{words_str}]. "
                        "Weave at most one into 1-2 of the three suggestions — never force every suggestion."
                    )
                if target_tense:
                    if target_tense.lower() in ("mixed", "karışık", "karışık (mixed)", "mixed (karışık - serbest)"):
                        parts.append("Target grammar: Mixed / Free — use whatever tense the teacher's question requires.")
                    else:
                        parts.append(
                            f"Target grammar focus: {target_tense} when it fits. "
                            f"CRITICAL: If the teacher's last turn requires a different tense, follow the dialogue — naturalness wins over forcing {target_tense}."
                        )
                if parts:
                    target_words_prompt = "\n" + "\n".join(parts)

            vocab_nudge = ""
            if practice_words_block:
                vocab_nudge = (
                    "\nOPTIONAL vocabulary (lowest priority):\n"
                    f"{practice_words_block}\n"
                    "At most ONE suggestion may gently use one word IF it fits. Never force absurd scenes."
                )

            flow_rules = (
                "WHO IS WHO (CRITICAL — most common failure):\n"
                "- TEACHER = conversation partner (assistant in history). Their actions are THEIRS, not the student's.\n"
                "- STUDENT = the learner. You write ONLY the student's NEXT line.\n"
                "- If the student asked 'Did YOU change your shirt?' and the teacher answered 'Yes I did', "
                "the student must NOT say 'Yes, I changed quickly' — that was the TEACHER's shirt story.\n"
                "- If the teacher's last turn already answered the student and then asked a NEW question "
                "(e.g. about work), the student must answer THAT new question — not restart the old topic as if it were about themselves.\n\n"
                "BAD (role swap):\n"
                "  Student asked about teacher's shirt → Teacher: 'I changed quickly. What work keeps you busy?'\n"
                "  Suggestion: 'Yes, I changed quickly!' ← WRONG (stealing teacher's answer)\n"
                "GOOD:\n"
                "  Suggestion: 'Mostly office meetings today — pretty busy. How about your afternoon?'\n\n"
                "PRIORITY:\n"
                "1) Respond to the teacher's LAST turn (especially any new question they asked).\n"
                "2) Keep facts continuous; do not contradict earlier student lines.\n"
                "3) Two-way OK: 2 reactions/answers + 1 natural ask-back about something the teacher just said.\n"
                "4) Optional vocab only if natural.\n\n"
                "HARD BANS:\n"
                "- Do NOT claim the teacher's actions as the student's ('I changed my shirt' when teacher said they did).\n"
                "- Do NOT re-answer a question the student already asked the teacher.\n"
                "- Do NOT invent absurd forced vocabulary stories or break the scene.\n"
            )

            messages_list = []

            # Spot the student's last line for continuity hints in the trigger prompt
            last_student = ""
            for msg in reversed(conversation_history):
                if msg.get("role") == "user" and (msg.get("text") or "").strip():
                    last_student = msg["text"].strip()
                    break

            # Labeled transcript helps avoid role-swap more than bare chat roles
            labeled_history = []
            for msg in conversation_history[-8:]:
                who = "TEACHER" if msg.get("role") == "assistant" else "STUDENT"
                text = (msg.get("text") or "").strip()
                if text:
                    labeled_history.append(f"{who}: {text}")
            history_block = "\n".join(labeled_history) if labeled_history else "(no prior turns)"

            if suggestions_tr:
                # Bilingual chips: English to speak + Turkish to understand
                if level in ("A1", "A2"):
                    en_rules = "simple English (~8-18 words); realistic"
                    sug_max_tok = 320
                elif level in ("B1", "B2"):
                    en_rules = "natural English (~15-30 words); 1-2 sentences"
                    sug_max_tok = 420
                else:
                    en_rules = "fluent English (~20-40 words)"
                    sug_max_tok = 520

                system_instruction = (
                    "You write reply suggestions for the STUDENT only (a Turkish learner).\n"
                    "Reply ONLY with a valid JSON array of exactly 3 objects:\n"
                    '{"en": "<what STUDENT should say next>", "tr": "<Turkish meaning>"}.\n'
                    "Never write lines for the teacher.\n\n"
                    f"{flow_rules}"
                    f"English style: {en_rules}. Turkish (tr) must match English (en).\n"
                    f"{target_words_prompt}"
                    f"{vocab_nudge}"
                )
                if is_scenario_coach and scenario_config:
                    target_words_list = [w.get("lemma", "") for w in scenario_config.get("target_words", []) if w.get("lemma")]
                    if target_words_list:
                        system_instruction += (
                            "\nScenario target lemmas (optional, natural only): "
                            f"[{', '.join(target_words_list)}]. Never force them."
                        )
                final_user_content = (
                    f"CONVERSATION SO FAR:\n{history_block}\n\n"
                    f"STUDENT'S LAST LINE (already spoken — do not repeat as if new):\n\"{last_student or '(none)'}\"\n\n"
                    f"TEACHER'S LAST LINE (student must react to THIS now):\n\"{last_teacher}\"\n\n"
                    "Write 3 next lines for the STUDENT only.\n"
                    "If the teacher just answered the student's question and asked something new, "
                    "answer the NEW question — do not steal the teacher's previous answer.\n"
                    "Include at least one natural ask-back to the teacher.\n"
                    'Return ONLY JSON: [{"en":"...","tr":"..."},{"en":"...","tr":"..."},{"en":"...","tr":"..."}]'
                )
            else:
                system_instruction = (
                    "You write reply suggestions for the STUDENT only.\n"
                    "Reply ONLY with a valid JSON array of exactly 3 English strings.\n"
                    "Never write lines for the teacher.\n\n"
                    f"{flow_rules}"
                    f"The suggestions must be {rules}.\n"
                    f"{target_words_prompt}"
                    f"{vocab_nudge}"
                )
                final_user_content = (
                    f"CONVERSATION SO FAR:\n{history_block}\n\n"
                    f"STUDENT'S LAST LINE:\n\"{last_student or '(none)'}\"\n\n"
                    f"TEACHER'S LAST LINE (react to THIS):\n\"{last_teacher}\"\n\n"
                    "Write 3 next lines for the STUDENT only. Do not steal the teacher's actions/answers.\n"
                    "Include at least one natural ask-back. Return ONLY a JSON array of 3 strings."
                )
                sug_max_tok = max_tok

            messages_list.append({"role": "system", "content": system_instruction})
            messages_list.append({
                "role": "user",
                "content": final_user_content,
            })

            if qwen_client:
                response = await qwen_client.chat.completions.create(
                    model=qwen_model,
                    messages=messages_list,
                    max_tokens=max(sug_max_tok, 512),
                    temperature=0.3,
                    # Qwen3 thinking models: keep reasoning disabled for fast JSON chips
                    extra_body={"enable_thinking": False},
                )
                content = (response.choices[0].message.content or "").strip()
            else:
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=messages_list,
                    max_tokens=sug_max_tok,
                    temperature=0.3
                )
                content = response.choices[0].message.content.strip()

            if "```" in content:
                content = content.replace("```json", "").replace("```", "").strip()
            raw_suggestions = json.loads(content)

            # Normalize for UI: {en, tr?} objects (legacy strings OK)
            suggestions = []
            if isinstance(raw_suggestions, list):
                for item in raw_suggestions:
                    if isinstance(item, str) and item.strip():
                        suggestions.append({"en": item.strip()})
                    elif isinstance(item, dict):
                        en = str(item.get("en") or item.get("text") or "").strip()
                        tr = str(item.get("tr") or item.get("meaning_tr") or "").strip()
                        if suggestions_tr:
                            if en:
                                suggestions.append({"en": en, "tr": tr} if tr else {"en": en})
                        else:
                            text = en or tr
                            if text:
                                suggestions.append({"en": text})

            await publish_data({
                "type": "agent_suggestions",
                "suggestions": suggestions,
                "lang": "bilingual" if suggestions_tr else "en",
            })
        except Exception as e:
            print(f"⚠️ Error generating suggestions: {e}")

    @session.on("user_input_transcribed")
    def on_user_input(event):
        """Live captions only. The turn's final text comes from conversation_item_added."""
        nonlocal turn_display
        text = (event.transcript or "").strip()
        if not text:
            return

        if event.is_final:
            turn_display = merge_turn_text(turn_display, text)
            display = turn_display
        else:
            display = merge_turn_text(turn_display, text) if turn_display else text

        loop = asyncio.get_event_loop()
        loop.create_task(publish_data({
            "type": "user_transcript",
            "text": display,
            "is_final": event.is_final
        }))

    @session.on("conversation_item_added")
    def on_item_added(event):
        nonlocal user_transcript, turn_display, message_count

        item = getattr(event, "item", None)
        # Handoffs / non-message items also fire this event — skip them
        role = getattr(item, "role", None)
        if role not in ("user", "assistant"):
            return

        # Source of truth: the (already repaired) text the tutor actually answered
        if role == "user":
            text = extract_text(getattr(item, "content", None)).strip()
            if text:
                user_transcript = text
                turn_display = ""
                message_count += 1
                loop = asyncio.get_event_loop()
                loop.create_task(publish_data({
                    "type": "user_transcript",
                    "text": text,
                    "raw_text": raw_user_transcript if raw_user_transcript != text else "",
                    "repaired": raw_user_transcript != text,
                    "is_final": True
                }))
            return

        if role == "assistant":
            text = extract_text(getattr(item, "content", None))
            if not text:
                return

            spoken = user_transcript

            async def _handle():
                nonlocal user_transcript
                await analyze_and_send_feedback(text, spoken)
                user_transcript = ""

            loop = asyncio.get_event_loop()
            loop.create_task(_handle())

    # Build the dynamic, level-adaptive prompt
    dynamic_instructions = build_system_prompt(
        level, scenario, vocab_words, scenario_config=scenario_config
    )

    await session.start(
        agent=EnglishTutor(instructions=dynamic_instructions, repair=repair_transcript),
        room=ctx.room,
    )

    # Manual mode: frontend calls end_turn / clear_turn via LiveKit RPC
    if turn_mode == "manual":
        @ctx.room.local_participant.register_rpc_method("end_turn")
        async def end_turn(_data):
            """Student finished speaking — commit the turn and generate a reply."""
            try:
                print("🖱️ end_turn RPC received — committing user turn")
                await session.commit_user_turn(
                    transcript_timeout=5.0,
                    stt_flush_duration=1.5,
                )
                return "ok"
            except asyncio.CancelledError:
                print("⚠️ end_turn cancelled")
                return "cancelled"
            except Exception as e:
                print(f"⚠️ end_turn failed: {e}")
                return f"error:{e}"

        @ctx.room.local_participant.register_rpc_method("clear_turn")
        async def clear_turn(_data):
            """Discard the current unfinished utterance."""
            try:
                session.clear_user_turn()
                nonlocal turn_display
                turn_display = ""
                await publish_data({
                    "type": "user_transcript",
                    "text": "",
                    "is_final": False,
                })
                print("🖱️ clear_turn RPC — discarded user turn")
                return "ok"
            except Exception as e:
                print(f"⚠️ clear_turn failed: {e}")
                return f"error:{e}"

    # Generate level-appropriate greeting
    greeting_instructions = greeting_for_scenario(
        level, scenario, vocab_words, scenario_config=scenario_config
    )
    await session.generate_reply(instructions=greeting_instructions)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm)
    )
