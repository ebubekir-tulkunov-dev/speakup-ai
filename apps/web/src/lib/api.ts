export const AI_URL = "/ai";

const API = "/api";

// ── Types ────────────────────────────────────────────────────────────

export interface VocabItem {
  user_word_id?: string | null;
  word_id: string;
  lemma: string;
  translation_tr: string;
  example?: string | null;
  example_tr?: string | null;
  mastery?: number;
  level?: string;
  word_type?: string;
  synonyms?: string[];
  antonyms?: string[];
  collocations?: string[];
  forms?: Record<string, string>;
  card_type?: "native_to_target" | "target_to_native" | "en_to_tr" | "tr_to_en";
  native_translation?: string;
  native_lang?: string;
  target_lang?: string;
  options?: string[];
}

export interface SubstitutionDrill {
  pattern: string;
  translation_tr: string;
  base_sentence: string;
  variants: Array<{
    word: string;
    sentence_en: string;
    sentence_tr: string;
  }>;
}

export interface SentenceEvaluation {
  is_correct: boolean;
  target_word_used_correctly: boolean;
  corrections?: Array<{
    wrong: string;
    correct: string;
    explanation_tr: string;
  }>;
  natural_alternative?: string;
  feedback_tr?: string;
}

export interface LyricLine {
  en: string;
  tr: string;
}

export interface PodcastUtterance {
  speaker: number;
  start: number;
  end: number;
  text: string;
}

export interface PodcastEpisode {
  id: string;
  youtube_url: string;
  youtube_id?: string | null;
  title: string;
  channel?: string | null;
  duration_sec?: number | null;
  status: "pending" | "downloading" | "transcribing" | "ready" | "failed" | string;
  error?: string | null;
  speaker_count: number;
  utterances: PodcastUtterance[];
  full_text?: string;
  created_at?: string | null;
  updated_at?: string | null;
  preview?: string;
}

export interface TopicSpeakEvaluation {
  is_adequate?: boolean;
  score?: number;
  corrections?: Array<{
    wrong: string;
    correct: string;
    explanation_tr: string;
  }>;
  improved_answer?: string;
  model_answer?: string;
  feedback_tr?: string;
  fluency_note_tr?: string;
  words_used?: string[];
  words_missed?: string[];
  patterns_used?: string[];
  patterns_missed?: string[];
}

export interface TopicSpeakTargetWord {
  lemma: string;
  type: "noun" | "verb" | "adjective" | "adverb" | string;
  tr?: string;
}

export interface TopicSpeakTargetPattern {
  pattern: string;
  example: string;
  tr?: string;
}

export interface TopicSpeakQuestion {
  id: string;
  level: string;
  topic: string;
  question: string;
  question_tr?: string | null;
  hint_tr?: string | null;
  target_words?: TopicSpeakTargetWord[];
  target_patterns?: TopicSpeakTargetPattern[];
  transcript?: string | null;
  evaluation?: TopicSpeakEvaluation | null;
  status: "asked" | "answered" | string;
  asked_at?: string | null;
  answered_at?: string | null;
  duplicate_avoided?: boolean;
  near_match?: Record<string, unknown> | null;
}

export interface ReaderQuestion {
  question: string;
  options: string[];
  answer: string;
  explanation_tr?: string;
}

export interface JournalCheckResult {
  corrections: Array<{
    wrong: string;
    correct: string;
    explanation_tr: string;
  }>;
  improved_text?: string;
  feedback_tr?: string;
}

export interface SpeakPromptsResult {
  topic_tr: string;
  tips_tr?: string;
  text_tr: string;
  text_en: string;
  focus_words?: string[];
  hint_tr?: string;
  word_pool_used?: number;
  angle?: string;
  tense?: string;
  native_lang?: string;
  target_lang?: string;
}

export interface CoachingTemplate {
  id: string;
  title_tr: string;
  description_tr: string;
  target_tense: string;
  target_tense_hint?: string;
  target_tense_example?: string;
  suggested_word_count?: number;
  suggested_word_types?: string[];
  difficulty?: string;
  category?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  scenario: string;
  tense: string;
  mode: string;
  level: string;
  message_count: number;
  preview: string;
  updated_at: string;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: Array<{
    role: string;
    content: string;
    correction_tr?: string | null;
    translation_tr?: string | null;
    corrections?: unknown[];
    new_words?: string[];
    fluency_note?: string | null;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || `Request failed: ${res.status}`;
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (typeof j.detail === "string") message = j.detail;
      else if (Array.isArray(j.detail)) {
        const msg = j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ");
        if (msg) message = msg;
      }
    } catch {
      /* keep raw text */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ── Chat streaming ───────────────────────────────────────────────────

export async function streamChat(
  message: string,
  history: Array<{ role: string; content: string }>,
  context: { scenario: string; tense: string; mode: string; level: string },
  onToken: (token: string) => void,
  onCorrection: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
  onFeedback: (feedback: {
    corrections?: Array<{ wrong: string; correct: string; rule?: string; explanation_tr: string }>;
    new_words_used?: string[];
    fluency_note?: string;
  }) => void,
): Promise<void> {
  try {
    const res = await fetch(`${AI_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message, history, ...context }),
    });

    if (!res.ok) {
      onError(await res.text().catch(() => `HTTP ${res.status}`));
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "message";

    const dispatch = (event: string, data: string) => {
      if (event === "token") onToken(data);
      else if (event === "correction") onCorrection(data);
      else if (event === "feedback") {
        try {
          onFeedback(JSON.parse(data));
        } catch {
          /* ignore malformed feedback */
        }
      } else if (event === "error") onError(data);
      else if (event === "done") onDone();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";

      for (const line of parts) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dispatch(eventName, line.slice(5).trimStart());
        } else if (line === "") {
          eventName = "message";
        }
      }
    }

    onDone();
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
  }
}

// ── API client ───────────────────────────────────────────────────────

export const api = {
  health: () => fetchJson<{ status: string; mongodb: boolean }>(`${API}/health`),

  dashboard: () =>
    fetchJson<{
      stats: Record<string, number>;
      vocab_due: number;
      errors_due: number;
    }>(`${API}/dashboard`),

  settings: () =>
    fetchJson<{
      native_lang: string;
      target_lang: string;
      daily_goal: number;
      settings: Record<string, string>;
    }>(`${API}/settings`),

  updateSettings: (body: {
    daily_goal?: number;
    tts_provider?: string;
    native_lang?: string;
  }) =>
    fetchJson(`${API}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  vocabQueue: (
    limit = 20,
    levels?: string[],
    wordType?: string,
    direction?: "native_to_target" | "target_to_native",
  ) =>
    fetchJson<{ items: VocabItem[] }>(
      `${API}/vocab/queue${qs({
        limit,
        levels: levels?.length ? levels.join(",") : undefined,
        word_type: wordType,
        direction,
      })}`,
    ),

  topWords: (limit = 100, level?: string) =>
    fetchJson<{ items: VocabItem[] }>(
      `${API}/vocab/top${qs({ limit, level: level === "ALL" ? undefined : level })}`,
    ),

  learnedVocab: () =>
    fetchJson<{ items: Array<VocabItem & { example?: string | null }> }>(`${API}/vocab/learned`),

  vocabReview: (
    wordId: string,
    quality: string,
    extra?: { is_correct?: boolean; user_answer?: string; card_type?: string },
  ) =>
    fetchJson(`${API}/vocab/review/${wordId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality, ...extra }),
    }),

  generateVocab: (body: {
    level: string;
    topic: string;
    count: number;
    word_type?: string;
  }) =>
    fetchJson(`${API}/vocab/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  captureWord: (lemma: string, context: string) =>
    fetchJson(`${API}/vocab/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lemma, context }),
    }),

  addVocabWord: (body: {
    lemma: string;
    translation_tr: string;
    word_type?: string;
    level?: string;
    example?: string;
    synonyms?: string[];
    source?: string;
  }) =>
    fetchJson(`${API}/vocab/add-single`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  translateVocabExample: (wordId: string) =>
    fetchJson<{ example_tr: string | null }>(`${API}/vocab/translate_example/${wordId}`),

  checkSentence: (wordId: string, sentence: string) =>
    fetchJson<SentenceEvaluation>(`${API}/vocab/check-sentence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word_id: wordId, sentence }),
    }),

  updateScenarioVocab: (wordIds: string[], usedCorrectly: boolean[]) =>
    fetchJson(`${API}/vocab/scenario-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word_ids: wordIds, used_correctly: usedCorrectly }),
    }),

  tenses: () =>
    fetchJson<{ items: Array<Record<string, unknown>> }>(`${API}/tenses`),

  tense: (id: string) => fetchJson<Record<string, unknown>>(`${API}/tenses/${id}`),

  generateTenseLesson: (id: string, exerciseCount: number) =>
    fetchJson(`${API}/tenses/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exercise_count: exerciseCount }),
    }),

  submitExercise: (exerciseId: string, answer: string) =>
    fetchJson(`${API}/tenses/exercises/${exerciseId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    }),

  errorQueue: () =>
    fetchJson<{ items: Array<Record<string, unknown>> }>(`${API}/errors/queue`),

  errorReview: (itemId: string, ok: boolean) =>
    fetchJson(`${API}/errors/${itemId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_correct: ok }),
    }),

  passages: () =>
    fetchJson<{ items: Array<Record<string, unknown>> }>(`${API}/reader/passages`),

  passage: (id: string) =>
    fetchJson<{ id: string; title: string; content: string; level: string; known_words: Record<string, number> }>(
      `${API}/reader/passages/${id}`,
    ),

  generateReading: (body: {
    level: string;
    topic: string;
    tense_focus: string;
    word_count: number;
  }) =>
    fetchJson(`${API}/reader/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  translate: (word: string) =>
    fetchJson<{ lemma: string; translation_tr: string | null; source?: string }>(
      `${API}/reader/translate${qs({ word })}`,
    ),

  markWord: (lemma: string, mastery: number) =>
    fetchJson(`${API}/reader/words/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lemma, mastery }),
    }),

  readerQuiz: (passageId: string) =>
    fetchJson<{ questions: ReaderQuestion[] }>(`${API}/reader/passages/${passageId}/quiz`, {
      method: "POST",
    }),

  submitReaderQuiz: (passageId: string, correctCount: number, total: number) =>
    fetchJson(`${API}/reader/passages/${passageId}/quiz/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correct_count: correctCount, total }),
    }),

  journalCheck: (text: string, level = "B1") =>
    fetchJson<JournalCheckResult>(`${API}/journal/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, level }),
    }),

  saveJournal: (body: {
    future_text: string;
    past_text: string;
    corrections: unknown[];
    feedback_tr: string | null;
    level?: string;
  }) =>
    fetchJson(`${API}/journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  journalHistory: () =>
    fetchJson<{ items: Array<Record<string, unknown>> }>(`${API}/journal`),

  translateLyrics: (lyrics: string) =>
    fetchJson<{ lines: LyricLine[] }>(`${API}/practice/lyrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lyrics }),
    }),

  substitutionDrill: (baseWord: string, level = "B1") =>
    fetchJson<SubstitutionDrill>(`${API}/practice/substitution`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_word: baseWord, level }),
    }),

  substitutionDone: (baseWord: string) =>
    fetchJson(`${API}/practice/substitution/done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_word: baseWord }),
    }),

  speakPrompts: (body: {
    level: string;
    topic: string;
    word_count: number;
    exclude_texts?: string[];
  }) =>
    fetchJson<SpeakPromptsResult>(`${API}/practice/speak-prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  speakPromptsDone: (topic: string, wordCount: number) =>
    fetchJson(`${API}/practice/speak-prompts/done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, word_count: wordCount }),
    }),

  scenarios: () =>
    fetchJson<{ items: Array<Record<string, unknown>> }>(`${API}/settings/scenarios`),

  generateScenario: (body: { level: string; topic: string; target_tense_slug: string | null }) =>
    fetchJson(`${API}/settings/scenarios/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  scenarioTemplates: () =>
    fetchJson<{ items: CoachingTemplate[] }>(`${API}/settings/scenario-templates`),

  generateCoachingScenario: (body: {
    level: string;
    target_tense: string;
    word_pool: Array<{ lemma: string; tr: string; type: string }>;
  }) =>
    fetchJson<{
      title_tr: string;
      description_tr: string;
      target_tense: string;
      target_tense_example: string;
    }>(`${API}/settings/scenarios/generate-coaching`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  scenarioWords: (level: string, wordTypes?: string, count = 8) =>
    fetchJson<{ items: Array<{ word_id: string; lemma: string; tr: string; type: string; level?: string; mastery?: number }> }>(
      `${API}/livekit/scenario-words${qs({ level, word_types: wordTypes, count })}`,
    ),

  livekitToken: (
    level: string,
    scenario: string,
    options?: {
      scenario_mode?: boolean;
      suggestions_tr?: boolean;
      turn_mode?: string;
      scenario_config?: Record<string, unknown>;
    },
  ) =>
    fetchJson<{ token: string; url: string; room: string; vocab_count?: number }>(
      `${API}/livekit/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level,
          scenario,
          scenario_mode: options?.scenario_mode ?? false,
          suggestions_tr: options?.suggestions_tr ?? true,
          turn_mode: options?.turn_mode ?? "manual",
          scenario_config: options?.scenario_config,
        }),
      },
    ),

  chatSessions: () =>
    fetchJson<{ items: ChatSessionSummary[] }>(`${API}/chat/sessions`),

  getChatSession: (id: string) =>
    fetchJson<ChatSessionDetail>(`${API}/chat/sessions/${id}`),

  createChatSession: (body: {
    scenario: string;
    tense: string;
    mode: string;
    level: string;
    title?: string;
  }) =>
    fetchJson<ChatSessionDetail>(`${API}/chat/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  saveChatSession: (
    id: string,
    body: {
      messages: unknown[];
      title?: string;
      level?: string;
      scenario?: string;
      tense?: string;
      mode?: string;
    },
  ) =>
    fetchJson<ChatSessionDetail>(`${API}/chat/sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  deleteChatSession: (id: string) =>
    fetchJson(`${API}/chat/sessions/${id}`, { method: "DELETE" }),

  podcastEpisodes: () =>
    fetchJson<{
      items: Array<{
        id: string;
        title: string;
        channel?: string | null;
        youtube_url: string;
        duration_sec?: number | null;
        status: string;
        speaker_count: number;
        error?: string | null;
        preview?: string;
        created_at?: string | null;
      }>;
    }>(`${API}/podcast/episodes`),

  podcastEpisode: (id: string) =>
    fetchJson<PodcastEpisode>(`${API}/podcast/episodes/${id}`),

  importPodcast: (url: string, language = "en") =>
    fetchJson<PodcastEpisode>(`${API}/podcast/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, language }),
    }),

  deletePodcast: (id: string) =>
    fetchJson(`${API}/podcast/episodes/${id}`, { method: "DELETE" }),

  topicSpeakTopics: () =>
    fetchJson<{ items: string[] }>(`${API}/topic-speak/topics`),

  topicSpeakNext: (body: {
    level: string;
    topic?: string;
    prefer_fresh_days?: number;
  }) =>
    fetchJson<TopicSpeakQuestion>(`${API}/topic-speak/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  topicSpeakAnswer: async (questionId: string, audio: Blob) => {
    const fd = new FormData();
    fd.append("question_id", questionId);
    fd.append("audio", audio, "answer.webm");
    const res = await fetch(`${API}/topic-speak/answer`, { method: "POST", body: fd });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text || `Request failed: ${res.status}`;
      try {
        const j = JSON.parse(text) as { detail?: unknown };
        if (typeof j.detail === "string") message = j.detail;
      } catch {
        /* keep */
      }
      throw new Error(message);
    }
    return res.json() as Promise<TopicSpeakQuestion>;
  },

  topicSpeakAnswerText: (questionId: string, transcript: string) =>
    fetchJson<TopicSpeakQuestion>(`${API}/topic-speak/answer-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, transcript }),
    }),

  topicSpeakHistory: (opts?: { level?: string; days?: number; limit?: number }) =>
    fetchJson<{ items: TopicSpeakQuestion[] }>(
      `${API}/topic-speak/history${qs({
        level: opts?.level,
        days: opts?.days,
        limit: opts?.limit,
      })}`,
    ),

  topicSpeakCheckSimilar: (question: string, level?: string, days?: number) =>
    fetchJson<{
      is_duplicate: boolean;
      near_match: Record<string, unknown> | null;
      candidates: Array<Record<string, unknown>>;
    }>(
      `${API}/topic-speak/check-similar${qs({ question, level, days })}`,
    ),

  translateText: (text: string, targetLang = "Turkish") =>
    fetchJson<{ translation: string }>(`${AI_URL}/generate/translate_text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_lang: targetLang }),
    }),

  chatSuggestions: (agentResponse: string, userMessage: string, scenario: string, level: string) =>
    fetchJson<{ suggestions: string[] }>(`${AI_URL}/generate/chat-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_response: agentResponse,
        user_message: userMessage,
        scenario,
        level,
      }),
    }),
};
