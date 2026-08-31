import { LiveKitRoom, RoomAudioRenderer, useVoiceAssistant, BarVisualizer, useRoomContext, useLocalParticipant } from "@livekit/components-react";
import { LocalAudioTrack } from "livekit-client";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic, MicOff, Volume2, Sparkles, Copy, Check, User, Bot,
  AlertTriangle, BookOpen, Clock, BarChart3, RotateCcw, ChevronDown, ChevronUp,
  Brain, Target, Dumbbell, Info, Wand2, Ear, Send, Trash2
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, type CoachingTemplate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "ws://127.0.0.1:7890";
/** DeepFilterNet3 suppression strength (0–100). Higher = more noise removed. */
const NOISE_SUPPRESSION_LEVEL = 80;

/** Flexible conversation modes (not rigid role-play). Values are passed to the voice agent. */
const FLEXIBLE_MODES = [
  {
    value: "Serbest sohbet",
    label: "Free Conversation",
    hint: "Two-way conversation — you can ask questions too",
  },
  {
    value: "mode:friend_day",
    label: "Like a friend — How was your day?",
    hint: "Casual two-way chat; share your day and ask them too",
  },
  {
    value: "mode:friend_casual",
    label: "Like a friend — Casual chat",
    hint: "Hobbies, movies, food — back-and-forth conversation",
  },
  {
    value: "mode:teacher_checkin",
    label: "Like a teacher — What should we practice today?",
    hint: "Teacher guides; you practice by asking questions too",
  },
  {
    value: "mode:teacher_practice",
    label: "Like a teacher — Dialogue practice",
    hint: "Real dialogue: answer and ask questions",
  },
  {
    value: "mode:opinion",
    label: "Sharing opinions",
    hint: "Exchange views — you can ask them too",
  },
  {
    value: "mode:interview",
    label: "Job interview (flexible)",
    hint: "Natural interview conversation, not a scripted scenario",
  },
  {
    value: "mode:vocab_practice",
    label: "Practice with words I've learned",
    hint: "Q&A using words from your flashcards",
  },
] as const;

// ── Types ────────────────────────────────────────────────────────────
interface Correction {
  wrong: string;
  correct: string;
  rule: string;
  explanation_tr: string;
}

interface NewWord {
  word: string;
  meaning_tr: string;
  example: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** What the recognizer originally heard, when it was repaired before reaching the tutor. */
  rawText?: string;
  timestamp: number;
  corrections?: Correction[];
  newWords?: NewWord[];
  fluencyNote?: string;
}

interface ScenarioWord {
  word_id: string;
  lemma: string;
  tr: string;
  type: string;
  level: string;
  mastery: number;
  used?: boolean;
}

interface CoachingScenarioConfig {
  id?: string;
  title_tr: string;
  description_tr: string;
  target_tense: string;
  target_tense_hint: string;
  target_tense_example: string;
  target_words: ScenarioWord[];
}

interface SessionStats {
  startTime: number;
  totalMessages: number;
  totalCorrections: Correction[];
  totalNewWords: NewWord[];
  fluencyNotes: string[];
  // Scenario Coaching details:
  isScenarioMode?: boolean;
  scenarioTitle?: string;
  scenarioTense?: string;
  targetWords?: ScenarioWord[];
  tenseCorrectCount?: number;
  tenseAttempts?: number;
}

interface ReplySuggestion {
  en: string;
  tr?: string;
}

// ── Suggestion Chip ──────────────────────────────────────────────────
function SuggestionChip({ suggestion, showTr = true }: { suggestion: ReplySuggestion; showTr?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.en);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex flex-col items-start gap-0.5 rounded-2xl border border-border bg-background/80 px-3.5 py-2 text-left hover:bg-primary/5 hover:border-primary/30 transition-all duration-200 cursor-pointer shadow-2xs max-w-full",
        copied && "border-emerald-500/50 bg-emerald-50"
      )}
    >
      <span className={cn(
        "inline-flex items-center gap-2 text-xs font-medium",
        copied ? "text-emerald-700" : "text-foreground"
      )}>
        <span>{suggestion.en}</span>
        {copied ? <Check className="size-3 text-emerald-600 shrink-0" /> : <Copy className="size-3 text-muted-foreground shrink-0" />}
      </span>
      {showTr && suggestion.tr && (
        <span className="text-[11px] text-muted-foreground leading-snug">{suggestion.tr}</span>
      )}
    </button>
  );
}

function normalizeSuggestions(raw: unknown): ReplySuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ReplySuggestion | null => {
      if (typeof item === "string" && item.trim()) return { en: item.trim() };
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const en = String(obj.en || obj.text || "").trim();
        const tr = String(obj.tr || obj.meaning_tr || "").trim();
        // Legacy Turkish-only items
        if (!en && tr) return { en: tr, tr };
        if (!en) return null;
        return tr ? { en, tr } : { en };
      }
      return null;
    })
    .filter((s): s is ReplySuggestion => !!s);
}

// ── Correction Badge ─────────────────────────────────────────────────
function CorrectionBadge({ correction }: { correction: Correction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className="rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-xs cursor-pointer hover:border-amber-300 transition-all duration-200"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="line-through text-red-500/80">{correction.wrong}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-semibold text-emerald-700">{correction.correct}</span>
          </div>
          {expanded && (
            <div className="mt-1.5 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700">{correction.rule}</Badge>
              <p className="text-muted-foreground leading-relaxed">{correction.explanation_tr}</p>
            </div>
          )}
        </div>
        {expanded ? <ChevronUp className="size-3 text-muted-foreground" /> : <ChevronDown className="size-3 text-muted-foreground" />}
      </div>
    </div>
  );
}

// ── New Word Card ────────────────────────────────────────────────────
function NewWordCard({ word }: { word: NewWord }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50/60 p-2.5 text-xs">
      <BookOpen className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
      <div>
        <span className="font-bold text-blue-800">{word.word}</span>
        <span className="text-muted-foreground"> — {word.meaning_tr}</span>
        {word.example && (
          <p className="text-muted-foreground/80 italic mt-0.5">"{word.example}"</p>
        )}
      </div>
    </div>
  );
}

// ── Chat Bubble ──────────────────────────────────────────────────────
function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser ? "items-end" : "items-start")}>
        {/* Main bubble */}
        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm shadow-xs",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted/75 backdrop-blur-xs border border-border/50 rounded-tl-sm"
        )}>
          <div className={cn(
            "text-[10px] font-bold mb-0.5 flex items-center gap-1 uppercase tracking-wide",
            isUser ? "opacity-70" : "text-muted-foreground"
          )}>
            {isUser ? <><User className="size-3" /> Me</> : <><Bot className="size-3" /> Assistant</>}
          </div>
          <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
        </div>

        {/* What the mic misheard, before it was repaired */}
        {isUser && message.rawText && (
          <div className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <Ear className="size-3 shrink-0 mt-0.5" />
            <span>
              Microphone heard <span className="line-through">{message.rawText}</span>; it was corrected.
            </span>
          </div>
        )}

        {/* Corrections under user bubble */}
        {isUser && message.corrections && message.corrections.length > 0 && (
          <div className="space-y-1.5 w-full">
            {message.corrections.map((c, i) => (
              <CorrectionBadge key={i} correction={c} />
            ))}
          </div>
        )}

        {/* New words under agent bubble */}
        {!isUser && message.newWords && message.newWords.length > 0 && (
          <div className="space-y-1.5 w-full">
            {message.newWords.map((w, i) => (
              <NewWordCard key={i} word={w} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Session Report ───────────────────────────────────────────────────
function SessionReport({ stats, onRestart }: { stats: SessionStats; onRestart: () => void }) {
  const duration = Math.round((Date.now() - stats.startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const uniqueCorrections = stats.totalCorrections.filter(
    (c, i, arr) => arr.findIndex(x => x.wrong === c.wrong) === i
  );
  const uniqueWords = stats.totalNewWords.filter(
    (w, i, arr) => arr.findIndex(x => x.word === w.word) === i
  );
  const accuracy = stats.totalMessages > 0
    ? Math.round(((stats.totalMessages - uniqueCorrections.length) / stats.totalMessages) * 100)
    : 100;

  const [savingVocab, setSavingVocab] = useState(false);
  const [vocabSaved, setVocabSaved] = useState(false);

  const handleSyncVocab = async () => {
    if (!stats.targetWords || stats.targetWords.length === 0) return;
    setSavingVocab(true);
    try {
      const ids = stats.targetWords.map(w => w.word_id);
      const used = stats.targetWords.map(w => !!w.used);
      await api.updateScenarioVocab(ids, used);
      setVocabSaved(true);
    } catch (e) {
      console.error("Failed to update scenario vocab:", e);
    } finally {
      setSavingVocab(false);
    }
  };

  const isCoaching = !!stats.isScenarioMode;
  const targetWords = stats.targetWords || [];
  const usedWords = targetWords.filter(w => w.used);
  const unusedWords = targetWords.filter(w => !w.used);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 animate-in fade-in-50 zoom-in-95 duration-500 pb-10">
      <PageHeader
        title={isCoaching ? "Coaching Report" : "Conversation Report"}
        description={isCoaching ? `Scenario "${stats.scenarioTitle}" completed successfully!` : "Free practice completed!"}
      />

      {/* Tense and Word Progress for Scenario Mode */}
      {isCoaching && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Brain className="size-36 text-primary" />
          </div>
          <CardHeader>
            <CardTitle className="text-md flex items-center gap-2 text-primary">
              <Target className="size-5" />
              Scenario Goal Status
            </CardTitle>
            <CardDescription>Your usage of the target grammar and vocabulary for this scenario.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tense Card */}
              <div className="rounded-xl border border-border/80 bg-background/50 p-4 space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Tense</p>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground text-lg">{stats.scenarioTense}</span>
                  <Badge variant={stats.tenseCorrectCount && stats.tenseCorrectCount > 0 ? "default" : "secondary"} className={cn(
                    "text-xs px-2.5",
                    stats.tenseCorrectCount && stats.tenseCorrectCount > 0
                      ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 hover:bg-emerald-500/15"
                      : "bg-amber-500/10 text-amber-700 border-amber-500/20 hover:bg-amber-500/15"
                  )}>
                    {stats.tenseCorrectCount && stats.tenseCorrectCount > 0 ? "Success" : "Not used"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You made <b>{stats.tenseAttempts || 0}</b> attempts to use this tense during the conversation.
                </p>
              </div>

              {/* Word Progress Card */}
              <div className="rounded-xl border border-border/80 bg-background/50 p-4 space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Vocabulary Usage</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-primary">{usedWords.length}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-sm font-semibold text-muted-foreground">{targetWords.length}</span>
                  <span className="text-xs text-muted-foreground ml-1">words used correctly</span>
                </div>
                {/* Progress bar */}
                <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${(usedWords.length / Math.max(1, targetWords.length)) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Target Words Detail */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Word Details</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Used Words */}
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/20 p-3.5 space-y-2">
                  <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                    <Check className="size-4 text-emerald-600 bg-emerald-100 rounded-full p-0.5" />
                    Words Used ({usedWords.length})
                  </p>
                  {usedWords.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {usedWords.map(w => (
                        <Badge key={w.word_id} variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20 px-2 py-0.5 text-xs">
                          {w.lemma} <span className="opacity-60 text-[10px] ml-1">({w.tr})</span>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No words used yet.</p>
                  )}
                </div>

                {/* Unused Words */}
                <div className="rounded-xl border border-muted bg-muted/20 p-3.5 space-y-2">
                  <p className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                    <Info className="size-4 text-muted-foreground" />
                    Unused Words ({unusedWords.length})
                  </p>
                  {unusedWords.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {unusedWords.map(w => (
                        <Badge key={w.word_id} variant="outline" className="bg-background text-muted-foreground border-border px-2 py-0.5 text-xs">
                          {w.lemma} <span className="opacity-60 text-[10px] ml-1">({w.tr})</span>
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-600 italic">Great! You used all the words.</p>
                  )}
                </div>
              </div>
            </div>

            {/* SRS Sync Card */}
            {targetWords.length > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in-50 duration-300">
                <div className="space-y-1 text-center md:text-left">
                  <p className="text-sm font-bold text-primary flex items-center justify-center md:justify-start gap-1.5">
                    <Brain className="size-4" />
                    Vocabulary Learning Pool (SRS) Integration
                  </p>
                  <p className="text-xs text-muted-foreground max-w-xl">
                    Words you used correctly in this conversation will have their mastery levels increased, and your flashcard schedule will be updated accordingly.
                  </p>
                </div>
                <Button
                  onClick={handleSyncVocab}
                  disabled={savingVocab || vocabSaved}
                  size="sm"
                  className={cn(
                    "font-semibold w-full md:w-auto shadow-sm cursor-pointer",
                    vocabSaved && "bg-emerald-600 hover:bg-emerald-600 text-white border-transparent"
                  )}
                >
                  {savingVocab ? "Saving..." : vocabSaved ? "✓ Words Updated!" : "Save Words to SRS"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="text-center py-4 bg-background shadow-xs">
          <Clock className="size-5 mx-auto text-primary mb-1" />
          <p className="text-xl font-bold">{minutes}:{seconds.toString().padStart(2, '0')}</p>
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Duration</p>
        </Card>
        <Card className="text-center py-4 bg-background shadow-xs">
          <BarChart3 className="size-5 mx-auto text-emerald-500 mb-1" />
          <p className="text-xl font-bold text-emerald-600">%{accuracy}</p>
          <p className="text-[10px] text-muted-foreground uppercase font-bold">Accuracy</p>
        </Card>
        <Card className="text-center py-4 bg-background shadow-xs">
          <BookOpen className="size-5 mx-auto text-blue-500 mb-1" />
          <p className="text-xl font-bold text-blue-600">{uniqueWords.length}</p>
          <p className="text-[10px] text-muted-foreground uppercase font-bold">New Words</p>
        </Card>
      </div>

      {/* Corrections Summary */}
      {uniqueCorrections.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Corrections ({uniqueCorrections.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {uniqueCorrections.map((c, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-3 text-xs space-y-1 bg-background shadow-2xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="line-through text-red-500/70">{c.wrong}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold text-emerald-700">{c.correct}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-auto border-muted-foreground/30">{c.rule}</Badge>
                </div>
                <p className="text-muted-foreground">{c.explanation_tr}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* New Words Summary */}
      {uniqueWords.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookOpen className="size-4 text-blue-500" />
              Words Learned ({uniqueWords.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {uniqueWords.map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border/60 p-3 text-xs bg-background shadow-2xs">
                <div>
                  <span className="font-bold text-blue-700">{w.word}</span>
                  <span className="text-muted-foreground"> — {w.meaning_tr}</span>
                  {w.example && <p className="text-muted-foreground/80 italic mt-0.5">"{w.example}"</p>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Fluency Notes */}
      {stats.fluencyNotes.filter(Boolean).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              Fluency Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {stats.fluencyNotes.filter(Boolean).slice(-5).map((note, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">•</span>
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Restart Button */}
      <Button
        onClick={onRestart}
        className="w-full font-semibold shadow-sm cursor-pointer"
        size="lg"
      >
        <RotateCcw className="size-4" />
        Start New Conversation
      </Button>
    </div>
  );
}

// ── Scenario Coach Panel (Sidebar) ───────────────────────────────────
function ScenarioCoachPanel({
  config,
  targetWords,
  tenseCorrectCount,
  tenseAttempts,
}: {
  config: CoachingScenarioConfig;
  targetWords: ScenarioWord[];
  tenseCorrectCount: number;
  tenseAttempts: number;
}) {
  return (
    <div className="w-full flex flex-col gap-4 bg-muted/20 p-4 rounded-xl border border-border/60">
      {/* Title & Description */}
      <div className="space-y-1.5 bg-background p-4 rounded-xl border border-border/40 shadow-xs">
        <h3 className="font-bold text-sm text-primary flex items-center gap-1.5">
          <Brain className="size-4 shrink-0" />
          {config.title_tr}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{config.description_tr}</p>
      </div>

      {/* Target Tense Focus */}
      <div className="bg-background p-4 rounded-xl border border-border/40 shadow-xs space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Target Tense Focus</span>
          <Badge variant={tenseCorrectCount > 0 ? "default" : "outline"} className={cn(
            "text-[9px] px-1.5 py-0 font-semibold border",
            tenseCorrectCount > 0
              ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
              : "bg-amber-500/10 text-amber-700 border-amber-500/20"
          )}>
            {tenseCorrectCount > 0 ? "✓ Used" : "Not used"}
          </Badge>
        </div>
        <p className="font-extrabold text-sm text-foreground">{config.target_tense}</p>
        <div className="text-[10px] text-muted-foreground leading-normal space-y-1">
          <div className="bg-secondary/40 rounded p-1.5 font-mono text-[10px] text-foreground/80">{config.target_tense_hint}</div>
          <p className="italic">Example: "{config.target_tense_example}"</p>
          {tenseAttempts > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Attempt count: <b>{tenseAttempts}</b>
            </p>
          )}
        </div>
      </div>

      {/* Target Vocabulary */}
      <div className="bg-background p-4 rounded-xl border border-border/40 shadow-xs flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Target Word List</span>
          <Badge variant="secondary" className="text-[10px] font-bold">
            {targetWords.filter(w => w.used).length} / {targetWords.length}
          </Badge>
        </div>

        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {targetWords.map((w) => (
            <div
              key={w.word_id}
              className={cn(
                "flex items-center justify-between rounded-lg border p-2.5 text-xs transition-all duration-200",
                w.used
                  ? "bg-emerald-500/5 border-emerald-200 text-emerald-800"
                  : "bg-background border-border/60 text-foreground"
              )}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold">{w.lemma}</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 scale-90 border-muted-foreground/30 opacity-70">
                    {w.level}
                  </Badge>
                </div>
                <span className="text-muted-foreground text-[10px]">{w.tr}</span>
              </div>

              <div className={cn(
                "size-5 rounded-full flex items-center justify-center border shrink-0",
                w.used
                  ? "bg-emerald-500/10 border-emerald-500 text-emerald-600"
                  : "bg-secondary border-border text-muted-foreground"
              )}>
                {w.used ? <Check className="size-3 stroke-[3]" /> : <span className="text-[9px]">•</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Voice Assistant UI (Active Session) ──────────────────────────────
function findAgentIdentity(room: { remoteParticipants: Map<string, { identity: string; isAgent?: boolean }> }): string | null {
  for (const p of room.remoteParticipants.values()) {
    if (p.isAgent) return p.identity;
  }
  const first = room.remoteParticipants.values().next().value;
  return first?.identity ?? null;
}

function VoiceAssistantUI({
  onSessionEnd,
  scenarioConfig,
  turnMode = "manual",
  showSuggestionTr = true,
  onShowSuggestionTrChange,
}: {
  onSessionEnd: (stats: SessionStats) => void;
  scenarioConfig?: CoachingScenarioConfig;
  turnMode?: "manual" | "auto";
  showSuggestionTr?: boolean;
  onShowSuggestionTrChange?: (show: boolean) => void;
}) {
  const { state, audioTrack } = useVoiceAssistant();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, microphoneTrack } = useLocalParticipant();
  const isMuted = !isMicrophoneEnabled;
  const isManual = turnMode === "manual";
  const [sending, setSending] = useState(false);

  // Client-side DeepFilterNet3 noise suppression on the published mic track
  useEffect(() => {
    const track = microphoneTrack?.track;
    if (!(track instanceof LocalAudioTrack)) return;

    let cancelled = false;

    (async () => {
      try {
        const { DeepFilterNoiseFilter, DeepFilterNoiseFilterProcessor } = await import(
          "deepfilternet3-noise-filter"
        );
        if (cancelled) return;
        if (!DeepFilterNoiseFilterProcessor.isSupported()) {
          console.warn("DeepFilter noise filter is not supported in this browser");
          return;
        }
        if (track.getProcessor()) return;

        const filter = DeepFilterNoiseFilter({
          sampleRate: 48000,
          noiseReductionLevel: NOISE_SUPPRESSION_LEVEL,
          enabled: true,
        });
        await track.setProcessor(filter);
        if (cancelled) {
          await track.stopProcessor().catch(() => {});
        }
      } catch (e) {
        console.error("Failed to enable DeepFilter noise filter:", e);
      }
    })();

    return () => {
      cancelled = true;
      track.stopProcessor().catch(() => {});
    };
  }, [microphoneTrack]);

  const toggleMute = async () => {
    if (!localParticipant) return;
    try {
      const targetState = !isMicrophoneEnabled;
      await localParticipant.setMicrophoneEnabled(targetState);
      
      // Secondary fallback using direct mute/unmute publications and hardware track disabling
      localParticipant.audioTrackPublications.forEach(pub => {
        if (targetState) {
          pub.unmute().catch(err => console.error("Error unmuting pub:", err));
        } else {
          pub.mute().catch(err => console.error("Error muting pub:", err));
        }
        
        if (pub.track) {
          const mediaTrack = (pub.track as any).mediaStreamTrack;
          if (mediaTrack) {
            mediaTrack.enabled = targetState;
          }
        }
      });
    } catch (e) {
      console.error("Failed to toggle microphone state:", e);
    }
  };

  // Chat history
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentUserText, setCurrentUserText] = useState("");
  const [isFinalTranscript, setIsFinalTranscript] = useState(false);
  const [suggestions, setSuggestions] = useState<ReplySuggestion[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Refs avoid stale closures in the dataReceived handler
  const currentUserTextRef = useRef("");
  const lastFinalUserTextRef = useRef("");
  const lastRawUserTextRef = useRef("");
  const [repairedFrom, setRepairedFrom] = useState("");

  const callAgentRpc = useCallback(async (method: "end_turn" | "clear_turn") => {
    if (!room || !localParticipant) return;
    const agentId = findAgentIdentity(room);
    if (!agentId) {
      console.warn("Agent not found for RPC", method);
      return;
    }
    await localParticipant.performRpc({
      destinationIdentity: agentId,
      method,
      payload: "",
    });
  }, [room, localParticipant]);

  const handleSendTurn = async () => {
    if (!isManual || sending) return;
    const text = (currentUserTextRef.current || "").trim();
    if (!text) return;
    setSending(true);
    try {
      await callAgentRpc("end_turn");
    } catch (e) {
      console.error("Failed to send turn:", e);
    } finally {
      setSending(false);
    }
  };

  const handleClearTurn = async () => {
    if (!isManual) return;
    try {
      currentUserTextRef.current = "";
      setCurrentUserText("");
      setIsFinalTranscript(false);
      setRepairedFrom("");
      await callAgentRpc("clear_turn");
    } catch (e) {
      console.error("Failed to clear turn:", e);
    }
  };

  // Scenario specific states
  const [targetWords, setTargetWords] = useState<ScenarioWord[]>(
    scenarioConfig?.target_words.map(w => ({ ...w, used: false })) || []
  );
  const [tenseCorrectCount, setTenseCorrectCount] = useState(0);
  const [tenseAttempts, setTenseAttempts] = useState(0);

  // Stats
  const [sessionStats] = useState<SessionStats>({
    startTime: Date.now(),
    totalMessages: 0,
    totalCorrections: [],
    totalNewWords: [],
    fluencyNotes: [],
  });

  // Grammar panel visibility
  const [showGrammar, setShowGrammar] = useState(true);

  // Pending feedback to attach to user messages
  const pendingFeedbackRef = useRef<{
    corrections: Correction[];
    newWords: NewWord[];
    fluencyNote: string;
  } | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentUserText]);

  // Data channel listener
  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));

        if (data.type === "user_transcript") {
          const text = (data.text || "").trim();
          if (!text) return;

          currentUserTextRef.current = text;
          setCurrentUserText(text);
          setIsFinalTranscript(!!data.is_final);
          setRepairedFrom(
            data.repaired &&
              data.raw_text &&
              data.raw_text.trim().toLowerCase().replace(/[^\w\s]/g, "") !==
                text.toLowerCase().replace(/[^\w\s]/g, "")
              ? data.raw_text
              : ""
          );
          if (data.is_final && text) {
            lastFinalUserTextRef.current = text;
            lastRawUserTextRef.current =
              data.repaired &&
              data.raw_text &&
              data.raw_text.trim().toLowerCase().replace(/[^\w\s]/g, "") !==
                text.toLowerCase().replace(/[^\w\s]/g, "")
                ? data.raw_text
                : "";
          }
        } else if (data.type === "agent_response") {
          // Prefer server transcript; fall back to refs (state would be stale in this closure)
          const userText = (
            data.user_transcript ||
            lastFinalUserTextRef.current ||
            currentUserTextRef.current ||
            ""
          ).trim();

          if (userText) {
            const feedback = pendingFeedbackRef.current;
            const rawText = (data.user_transcript_raw || lastRawUserTextRef.current || "").trim();
            const userMsg: ChatMessage = {
              id: `user-${Date.now()}`,
              role: "user",
              text: userText,
              rawText:
                rawText &&
                rawText.toLowerCase().replace(/[^\w\s]/g, "") !==
                  userText.toLowerCase().replace(/[^\w\s]/g, "")
                  ? rawText
                  : undefined,
              timestamp: Date.now(),
              corrections: feedback?.corrections,
            };
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              role: "assistant",
              text: data.agent_response,
              timestamp: Date.now(),
              newWords: feedback?.newWords,
              fluencyNote: feedback?.fluencyNote,
            };
            setMessages(prev => [...prev, userMsg, agentMsg]);
            sessionStats.totalMessages += 1;
            pendingFeedbackRef.current = null;
          } else {
            // Agent spoke first (greeting)
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              role: "assistant",
              text: data.agent_response,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, agentMsg]);
          }
          currentUserTextRef.current = "";
          lastFinalUserTextRef.current = "";
          lastRawUserTextRef.current = "";
          setCurrentUserText("");
          setIsFinalTranscript(false);
          setRepairedFrom("");
          setSuggestions([]);
        } else if (data.type === "agent_feedback") {
          // Store feedback to attach to the most recent user message
          const corrections = data.corrections || [];
          const newWords = data.new_words || [];
          const fluencyNote = data.fluency_note || "";

          sessionStats.totalCorrections.push(...corrections);
          sessionStats.totalNewWords.push(...newWords);
          if (fluencyNote) sessionStats.fluencyNotes.push(fluencyNote);

          // Try to attach to the last user message in history
          setMessages(prev => {
            const updated = [...prev];
            // Find the last user message that doesn't have corrections yet
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === "user" && !updated[i].corrections?.length) {
                updated[i] = {
                  ...updated[i],
                  corrections,
                };
                break;
              }
            }
            // Find the last agent message to attach new words
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === "assistant" && !updated[i].newWords?.length) {
                updated[i] = {
                  ...updated[i],
                  newWords,
                  fluencyNote,
                };
                break;
              }
            }
            return updated;
          });

          // Also store as pending in case messages arrive out of order
          pendingFeedbackRef.current = { corrections, newWords, fluencyNote };
        } else if (data.type === "agent_suggestions") {
          setSuggestions(normalizeSuggestions(data.suggestions));
        } else if (data.type === "scenario_feedback") {
          const wordMatches: string[] = data.word_matches || [];
          const tenseCorrect: boolean = data.tense_correct || false;
          const currentAttempts: number = data.tense_attempts || 0;

          if (wordMatches.length > 0) {
            setTargetWords(prev =>
              prev.map(w => {
                if (wordMatches.some(m => m.toLowerCase() === w.lemma.toLowerCase())) {
                  return { ...w, used: true };
                }
                return w;
              })
            );
          }

          if (tenseCorrect) {
            setTenseCorrectCount(c => c + 1);
          }
          if (currentAttempts > 0) {
            setTenseAttempts(prev => prev + currentAttempts);
          }
        }
      } catch (e) {
        console.error("Error decoding data:", e);
      }
    };

    room.on("dataReceived", handleDataReceived);
    return () => { room.off("dataReceived", handleDataReceived); };
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnd = useCallback(() => {
    onSessionEnd({
      ...sessionStats,
      isScenarioMode: !!scenarioConfig,
      scenarioTitle: scenarioConfig?.title_tr,
      scenarioTense: scenarioConfig?.target_tense,
      targetWords: targetWords,
      tenseCorrectCount: tenseCorrectCount,
      tenseAttempts: tenseAttempts,
    });
  }, [onSessionEnd, sessionStats, scenarioConfig, targetWords, tenseCorrectCount, tenseAttempts]);

  const labels: Record<string, string> = {
    listening: "Listening to you...",
    thinking: "Thinking...",
    speaking: "Speaking...",
    disconnected: "Disconnected",
    connecting: "Assistant connecting...",
    initializing: "Assistant preparing...",
    idle: "Ready — start speaking",
  };

  const isActive = state === "listening" || state === "speaking";
  const isConnecting = state === "connecting" || state === "initializing";

  // If agent never joins, don't leave the user stuck forever
  useEffect(() => {
    if (!isConnecting) return;
    const t = setTimeout(() => {
      console.warn("Voice agent did not connect in time");
    }, 20000);
    return () => clearTimeout(t);
  }, [isConnecting]);

  // Count session corrections
  const totalErrors = sessionStats.totalCorrections.length;
  const totalWords = sessionStats.totalNewWords.filter(
    (w, i, arr) => arr.findIndex(x => x.word === w.word) === i
  ).length;

  const content = (
    <div className="flex flex-col gap-4 w-full">
      {/* ── Status Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Pulse indicator */}
          <div className="relative">
            {isActive && (
              <>
                <div className="absolute inset-0 size-10 rounded-full bg-primary/20 animate-ripple" style={{ animationDelay: "0s" }} />
                <div className="absolute inset-0 size-10 rounded-full bg-primary/10 animate-ripple" style={{ animationDelay: "0.7s" }} />
              </>
            )}
            <div className={cn(
              "relative z-10 flex size-10 items-center justify-center rounded-full border shadow-sm transition-all duration-300",
              state === "speaking" ? "bg-emerald-500/10 border-emerald-500 text-emerald-600" :
              state === "listening" ? "bg-blue-500/10 border-primary text-primary" :
              state === "thinking" ? "bg-amber-500/10 border-amber-500 text-amber-600 animate-pulse" :
              "bg-secondary border-border text-muted-foreground"
            )}>
              {state === "speaking" ? <Volume2 className="size-5" /> : <Mic className="size-5" />}
            </div>
          </div>

          <div>
            <Badge className={cn(
              "text-[10px] px-2 py-0.5 font-semibold border",
              state === "speaking" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
              state === "listening" ? "bg-blue-500/10 text-blue-500 border-blue-500/20" :
              state === "thinking" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
              "bg-secondary/50 text-muted-foreground border-border"
            )}>
              {labels[state] ?? state}
            </Badge>
            <div className="h-4 w-20 mt-0.5 overflow-hidden flex items-center opacity-50">
              <BarVisualizer state={state} barCount={5} trackRef={audioTrack} />
            </div>
          </div>
        </div>

        {/* Stats badges */}
        <div className="flex items-center gap-2">
          {totalErrors > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-200 text-amber-700 bg-amber-50">
              <AlertTriangle className="size-3" /> {totalErrors} errors
            </Badge>
          )}
          {totalWords > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1 border-blue-200 text-blue-700 bg-blue-50">
              <BookOpen className="size-3" /> {totalWords} words
            </Badge>
          )}
        </div>
      </div>

      {/* Connecting hint */}
      {isConnecting && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Assistant is joining the room…</p>
          <p className="text-amber-700/90">
            Takes 10–15 seconds. If it gets stuck, press End and restart; the voice agent should be running:
            <code className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono">./scripts/dev.sh voice</code>
          </p>
        </div>
      )}

      {/* ── Chat History ── */}
      <div className="relative rounded-xl border border-border/60 bg-gradient-to-b from-background to-muted/20 overflow-hidden">
        <div className="max-h-[min(50vh,480px)] min-h-[280px] overflow-y-auto p-4 space-y-3 scroll-smooth">
          {messages.length === 0 && !currentUserText && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Bot className="size-8 mx-auto mb-2 opacity-40" />
              <p>Waiting for the conversation to start...</p>
            </div>
          )}

          {messages.map(msg => (
            <ChatBubble key={msg.id} message={msg} />
          ))}

          <div ref={chatEndRef} />
        </div>

        {/* Fade at top */}
        {messages.length > 3 && (
          <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-background to-transparent pointer-events-none" />
        )}
      </div>

      {/* ── Live STT Panel (always visible during session) ── */}
      <div
        className={cn(
          "rounded-xl border p-3.5 transition-all duration-300",
          state === "listening"
            ? "border-primary/40 bg-primary/5 shadow-sm"
            : currentUserText
            ? "border-primary/30 bg-primary/5"
            : "border-border/60 bg-muted/20"
        )}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <Mic className={cn(
            "size-3.5 shrink-0",
            state === "listening" ? "text-primary animate-pulse" : "text-muted-foreground"
          )} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {isMuted
              ? "Speech Paused"
              : state === "listening"
              ? (isManual ? "Listening — press Send when done" : "Listening to you — speak now")
              : state === "thinking"
              ? "Preparing response..."
              : state === "speaking"
              ? "Assistant is speaking"
              : currentUserText
              ? (isFinalTranscript ? "What you said (ready)" : "Transcribing live...")
              : "Microphone ready"}
          </span>
        </div>
        {isMuted ? (
          <p className="text-xs text-amber-600 font-medium">
            Listening paused. Click the "Resume (Listen)" button below to continue speaking.
          </p>
        ) : state === "listening" || (currentUserText && state !== "speaking") ? (
          currentUserText ? (
            <>
              <p className={cn(
                "text-sm leading-relaxed font-medium",
                isFinalTranscript ? "text-foreground" : "text-foreground/80"
              )}>
                {currentUserText}
                {!isFinalTranscript && <span className="animate-pulse ml-0.5 text-primary">|</span>}
              </p>
              {repairedFrom && (
                <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <Ear className="size-3 shrink-0 mt-0.5" />
                  <span>Heard: <span className="line-through">{repairedFrom}</span></span>
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground/70 italic">
              Your speech will appear here when you start talking...
            </p>
          )
        ) : state === "thinking" ? (
          <p className="text-xs text-amber-600 animate-pulse font-medium">
            Analyzing what you said and preparing a response...
          </p>
        ) : state === "speaking" ? (
          <p className="text-xs text-emerald-600 font-medium">
            The assistant is responding out loud. Listen...
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/70 italic">
            Ready to speak. Start talking...
          </p>
        )}
      </div>

      {/* ── Manual send (commit turn) ── */}
      {isManual && !isMuted && (
        <div className="flex gap-2 w-full animate-in fade-in duration-200">
          <Button
            type="button"
            variant="outline"
            className="h-11 px-3 text-xs font-semibold cursor-pointer"
            onClick={handleClearTurn}
            disabled={!currentUserText.trim() || sending || state === "thinking" || state === "speaking"}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>
          <Button
            type="button"
            className="flex-1 h-11 font-bold shadow-sm cursor-pointer text-sm"
            onClick={handleSendTurn}
            disabled={!currentUserText.trim() || sending || state === "thinking" || state === "speaking"}
          >
            <Send className="size-4" />
            {sending ? "Sending..." : "Send"}
          </Button>
        </div>
      )}
      {isManual && (
        <p className="text-[11px] text-muted-foreground px-0.5 -mt-1">
          Manual mode: Take your time — press <b>Send</b> when you finish speaking. The assistant won't respond during silence.
        </p>
      )}

      {/* ── Suggestions ── */}
      {suggestions.length > 0 && (
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-[10px] font-bold text-muted-foreground flex items-center gap-1 flex-wrap uppercase tracking-wider min-w-0">
              <Sparkles className="size-3 text-amber-500 animate-pulse shrink-0" />
              Suggested replies
              {showSuggestionTr && suggestions.some((s) => s.tr) && (
                <span className="normal-case font-medium tracking-normal text-muted-foreground/80">
                  — EN + TR
                </span>
              )}
            </div>
            {onShowSuggestionTrChange && suggestions.some((s) => s.tr) && (
              <button
                type="button"
                onClick={() => onShowSuggestionTrChange(!showSuggestionTr)}
                className={cn(
                  "shrink-0 text-[10px] font-semibold px-2 py-1 rounded-full border cursor-pointer transition-colors",
                  showSuggestionTr
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-muted text-muted-foreground border-border"
                )}
                title={showSuggestionTr ? "Hide Turkish translation" : "Show Turkish translation"}
              >
                TR {showSuggestionTr ? "on" : "off"}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <SuggestionChip key={i} suggestion={s} showTr={showSuggestionTr} />
            ))}
          </div>
        </div>
      )}

      {/* ── Grammar Toggle ── */}
      {(sessionStats.totalCorrections.length > 0 || sessionStats.totalNewWords.length > 0) && (
        <button
          onClick={() => setShowGrammar(!showGrammar)}
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1"
        >
          {showGrammar ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          Grammar & Vocabulary Panel
        </button>
      )}

      {/* ── Action Buttons ── */}
      <div className="flex gap-3 w-full">
        <Button
          variant={isMuted ? "default" : "outline"}
          className={cn(
            "flex-1 font-bold shadow-xs cursor-pointer border-border transition-all duration-200 h-10 text-xs",
            isMuted ? "bg-amber-600 hover:bg-amber-500 text-white border-transparent animate-pulse" : "hover:bg-accent"
          )}
          onClick={toggleMute}
        >
          {isMuted ? (
            <>
              <Mic className="size-4 mr-2" />
              Resume (Listen)
            </>
          ) : (
            <>
              <MicOff className="size-4 mr-2" />
              Pause
            </>
          )}
        </Button>
        <Button
          variant="destructive"
          className="flex-1 font-bold shadow-xs cursor-pointer h-10 text-xs"
          onClick={handleEnd}
        >
          <RotateCcw className="size-4 mr-2" /> End & Report
        </Button>
      </div>
    </div>
  );

  if (scenarioConfig) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 w-full items-start">
        <div className="lg:col-span-6 flex flex-col gap-4">
          {content}
        </div>
        <div className="lg:col-span-4 h-full">
          <ScenarioCoachPanel
            config={scenarioConfig}
            targetWords={targetWords}
            tenseCorrectCount={tenseCorrectCount}
            tenseAttempts={tenseAttempts}
          />
        </div>
      </div>
    );
  }

  return content;
}

// ── Main Page ────────────────────────────────────────────────────────
export function VoicePage() {
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [level, setLevel] = useState("B1");
  const [selectedScenario, setSelectedScenario] = useState("Serbest sohbet");
  const [suggestionsTr, setSuggestionsTr] = useState(true); // UI: show Turkish under EN chips
  const [turnMode, setTurnMode] = useState<"manual" | "auto">("manual");
  const [sessionReport, setSessionReport] = useState<SessionStats | null>(null);

  // Scenario Coaching States
  const [activeTab, setActiveTab] = useState<"free" | "coach">("free");
  const [coachingTemplates, setCoachingTemplates] = useState<CoachingTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CoachingTemplate | null>(null);
  const [coachingConfig, setCoachingConfig] = useState<CoachingScenarioConfig | undefined>(undefined);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Custom AI Coaching States
  const [customTopic, setCustomTopic] = useState("");
  const [customTense, setCustomTense] = useState("Mixed");
  const [isGeneratingCustom, setIsGeneratingCustom] = useState(false);
  const [isFetchingToken, setIsFetchingToken] = useState(false);

  const { data: scenariosData } = useQuery({
    queryKey: ["scenarios"],
    queryFn: api.scenarios,
  });

  const { data: learnedVocab } = useQuery({
    queryKey: ["learned-vocab"],
    queryFn: api.learnedVocab,
  });
  const learnedCount = learnedVocab?.items?.length ?? 0;

  // Load coaching templates when switching to coaching tab
  useEffect(() => {
    if (activeTab === "coach" && coachingTemplates.length === 0) {
      setLoadingTemplates(true);
      api.scenarioTemplates()
        .then(res => {
          setCoachingTemplates(res.items || []);
          if (res.items && res.items.length > 0) {
            setSelectedTemplate(res.items[0]);
          }
        })
        .catch(err => console.error("Error loading coaching templates:", err))
        .finally(() => setLoadingTemplates(false));
    }
  }, [activeTab, coachingTemplates.length]);

  // Load prioritized target words when selected template changes
  useEffect(() => {
    if (activeTab === "coach" && selectedTemplate) {
      const types = selectedTemplate.suggested_word_types?.join(",");
      const count = selectedTemplate.suggested_word_count || 8;
      api.scenarioWords(level, types, count)
        .then(res => {
          setCoachingConfig({
            title_tr: selectedTemplate.title_tr,
            description_tr: selectedTemplate.description_tr,
            target_tense: selectedTemplate.target_tense,
            target_tense_hint: selectedTemplate.target_tense_hint,
            target_tense_example: selectedTemplate.target_tense_example,
            target_words: res.items || [],
          });
        })
        .catch(err => console.error("Error fetching scenario words:", err));
    }
  }, [selectedTemplate, level, activeTab]);

  // Generate dynamic AI coaching scenario
  const handleGenerateCustomCoaching = async () => {
    if (!customTopic.trim()) return;
    setIsGeneratingCustom(true);
    try {
      // 1. Fetch candidate words matching the current level
      const wordsRes = await api.scenarioWords(level, undefined, 10);
      const wordPool = (wordsRes.items || []).map(w => ({
        lemma: w.lemma,
        tr: w.tr,
        type: w.type,
      }));

      // 2. Call AI service to generate a natural coaching scenario
      const aiScenario = await api.generateCoachingScenario({
        level,
        target_tense: customTense,
        word_pool: wordPool,
      });

      // 3. Create a coaching config
      const generatedConfig: CoachingScenarioConfig = {
        title_tr: aiScenario.title_tr,
        description_tr: aiScenario.description_tr,
        target_tense: aiScenario.target_tense,
        target_tense_hint: "Subject + verb structures matching the target tense",
        target_tense_example: aiScenario.target_tense_example,
        target_words: wordsRes.items || [],
      };

      setCoachingConfig(generatedConfig);
      setSelectedTemplate(null); // Deselect pre-defined template
    } catch (e) {
      console.error("Failed to generate custom coaching scenario:", e);
    } finally {
      setIsGeneratingCustom(false);
    }
  };

  const connect = async () => {
    setSessionReport(null);
    setIsFetchingToken(true);
    try {
      let res;
      if (activeTab === "coach" && coachingConfig) {
        // Post request with body payload for scenario coaching mode
        res = await api.livekitToken(level, coachingConfig.title_tr, {
          scenario_mode: true,
          // Always generate bilingual; UI toggles whether TR is visible
          suggestions_tr: true,
          turn_mode: turnMode,
          scenario_config: {
            description_tr: coachingConfig.description_tr,
            target_tense: coachingConfig.target_tense,
            target_tense_example: coachingConfig.target_tense_example,
            target_words: coachingConfig.target_words.map(w => ({
              word_id: w.word_id,
              lemma: w.lemma,
              tr: w.tr,
              type: w.type,
            })),
          },
        });
      } else {
        // Standard voice token call
        res = await api.livekitToken(level, selectedScenario, {
          suggestions_tr: true,
          turn_mode: turnMode,
        });
      }

      if (res?.token) {
        setToken(res.token);
        setConnected(true);
      }
    } catch (err) {
      console.error("Token fetch failed:", err);
    } finally {
      setIsFetchingToken(false);
    }
  };

  const handleSessionEnd = (stats: SessionStats) => {
    setSessionReport(stats);
    setConnected(false);
    setToken(null);
  };

  const handleRestart = () => {
    setSessionReport(null);
  };

  // ── Report Screen ──
  if (sessionReport) {
    return <SessionReport stats={sessionReport} onRestart={handleRestart} />;
  }

  // ── Pre-connection Screen ──
  if (!connected || !token) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 animate-in fade-in-50 duration-300">
        <PageHeader title="Live Conversation" description="Spoken English practice and coaching" />
        <Card className="shadow-md border-border/60">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">Conversation Assistant & Coach</CardTitle>
            <CardDescription>Deepgram STT + GPT-4o-mini + Cartesia/Minimax TTS</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 py-6">
            
            {/* Level Selector */}
            <div className="w-full space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Speaking Level
              </label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="w-full border-border bg-white shadow-2xs">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A1">A1 - Beginner</SelectItem>
                  <SelectItem value="A2">A2 - Elementary</SelectItem>
                  <SelectItem value="B1">B1 - Intermediate</SelectItem>
                  <SelectItem value="B2">B2 - Upper Intermediate</SelectItem>
                  <SelectItem value="C1">C1 - Advanced</SelectItem>
                  <SelectItem value="C2">C2 - Proficient</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Mode Tab Switcher */}
            <div className="w-full bg-muted/60 p-1.5 rounded-xl flex gap-1 border border-border/30">
              <button
                onClick={() => setActiveTab("free")}
                className={cn(
                  "flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer flex items-center justify-center gap-2",
                  activeTab === "free" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles className="size-3.5" />
                Free Conversation Modes
              </button>
              <button
                onClick={() => setActiveTab("coach")}
                className={cn(
                  "flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer flex items-center justify-center gap-2",
                  activeTab === "coach" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Dumbbell className="size-3.5" />
                Scenario Coaching Mode
              </button>
            </div>

            {/* Content for Tabs */}
            {activeTab === "free" ? (
              <div className="w-full space-y-4 animate-in fade-in-40 duration-200">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Conversation Style
                  </label>
                  <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                    <SelectTrigger className="w-full border-border bg-white shadow-2xs">
                      <SelectValue placeholder="How would you like to talk?" />
                    </SelectTrigger>
                    <SelectContent>
                      {FLEXIBLE_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                      {(scenariosData?.items || []).length > 0 && (
                        <>
                          {(scenariosData?.items || []).map((s) => (
                            <SelectItem key={s.id} value={s.title}>
                              Role: {s.title} ({s.difficulty})
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {FLEXIBLE_MODES.find((m) => m.value === selectedScenario)?.hint && (
                    <p className="text-[11px] text-muted-foreground px-0.5">
                      {FLEXIBLE_MODES.find((m) => m.value === selectedScenario)?.hint}
                    </p>
                  )}
                  {selectedScenario === "mode:vocab_practice" && (
                    <p className="text-[11px] px-0.5">
                      {learnedCount > 0 ? (
                        <span className="text-primary font-medium">
                          {Math.min(learnedCount, 20)} / {learnedCount} learned words will be included in this session.
                        </span>
                      ) : (
                        <span className="text-amber-600">
                          No flashcard practice yet. Complete a few cards on the Vocabulary page first.
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="w-full space-y-5 animate-in fade-in-40 duration-200">
                {/* Templates Grid */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Scenario Selection
                  </label>
                  {loadingTemplates ? (
                    <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">Loading templates...</div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1">
                      {coachingTemplates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setSelectedTemplate(t)}
                          className={cn(
                            "p-3 rounded-xl border text-left text-xs transition-all duration-200 hover:border-primary/40 cursor-pointer flex flex-col gap-1 shadow-2xs",
                            selectedTemplate?.id === t.id
                              ? "bg-primary/5 border-primary text-primary-foreground font-semibold"
                              : "bg-background border-border text-foreground"
                          )}
                        >
                          <span className={cn("font-bold text-[13px]", selectedTemplate?.id === t.id ? "text-primary" : "text-foreground")}>{t.title_tr}</span>
                          <span className="text-muted-foreground text-[10px] truncate max-w-full">{t.target_tense}</span>
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 w-fit bg-secondary/30 mt-0.5">{t.difficulty}</Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* AI Custom Scenario Form */}
                <div className="border border-border/60 bg-muted/20 p-4 rounded-xl space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Wand2 className="size-4 text-primary animate-pulse" />
                    <p className="text-xs font-bold text-primary uppercase tracking-wider">Generate Custom Scenario with AI</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Topic</span>
                      <input
                        type="text"
                        placeholder="e.g. Ordering coffee at a café, library discussion"
                        value={customTopic}
                        onChange={(e) => setCustomTopic(e.target.value)}
                        className="w-full text-xs rounded-lg border border-border px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary shadow-2xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Target Tense</span>
                      <Select value={customTense} onValueChange={setCustomTense}>
                        <SelectTrigger className="w-full text-xs border-border bg-background shadow-2xs h-8">
                          <SelectValue placeholder="Select tense" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Mixed">Mixed (Flexible)</SelectItem>
                          <SelectItem value="Past Simple">Past Simple</SelectItem>
                          <SelectItem value="Present Simple">Present Simple</SelectItem>
                          <SelectItem value="Present Perfect">Present Perfect</SelectItem>
                          <SelectItem value="Future (will / going to)">Future Plans</SelectItem>
                          <SelectItem value="Modal Verbs (should/could)">Modals (should / could)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    onClick={handleGenerateCustomCoaching}
                    disabled={isGeneratingCustom || !customTopic.trim()}
                    className="w-full text-xs font-bold h-9 mt-1 cursor-pointer"
                    variant="outline"
                  >
                    {isGeneratingCustom ? "Designing scenario..." : "Design with AI"}
                  </Button>
                </div>

                {/* Coaching Scenario Config Preview */}
                {coachingConfig && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold text-primary uppercase tracking-wider">Selected Scenario Summary</p>
                      <p className="font-bold text-sm text-foreground">{coachingConfig.title_tr}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{coachingConfig.description_tr}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Target Grammar</span>
                        <Badge variant="outline" className="border-primary/20 bg-background text-primary text-xs px-2 py-0.5">{coachingConfig.target_tense}</Badge>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Target Words ({coachingConfig.target_words.length})</span>
                        <div className="flex flex-wrap gap-1">
                          {coachingConfig.target_words.slice(0, 5).map(w => (
                            <Badge key={w.word_id} variant="secondary" className="text-[9px] px-1 py-0 h-4 border border-border">{w.lemma}</Badge>
                          ))}
                          {coachingConfig.target_words.length > 5 && <span className="text-[9px] text-muted-foreground font-semibold ml-1">+{coachingConfig.target_words.length - 5} more</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Turn mode: manual send vs auto endpointing */}
            <div className="w-full space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Turn Submission
              </label>
              <div className="w-full bg-muted/60 p-1.5 rounded-xl flex gap-1 border border-border/30">
                <button
                  type="button"
                  onClick={() => setTurnMode("manual")}
                  className={cn(
                    "flex-1 py-2.5 px-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer flex flex-col items-center gap-0.5",
                    turnMode === "manual" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Send className="size-3.5" />
                    Manual
                  </span>
                  <span className="text-[10px] font-medium opacity-70 normal-case">Press Send when done</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTurnMode("auto")}
                  className={cn(
                    "flex-1 py-2.5 px-3 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer flex flex-col items-center gap-0.5",
                    turnMode === "auto" ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Mic className="size-3.5" />
                    Automatic
                  </span>
                  <span className="text-[10px] font-medium opacity-70 normal-case">Responds after silence</span>
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground px-0.5">
                {turnMode === "manual"
                  ? "Choose this if you need more time: speak, think, then press Send. The assistant won't reply on its own."
                  : "The assistant replies automatically after a short pause — smoother flow, but the pace can feel faster."}
              </p>
            </div>

            {/* Suggestion language option */}
            <div className="w-full rounded-xl border border-border/60 bg-background p-3.5 flex items-start justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-amber-500 shrink-0" />
                  Show Turkish translation
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Show Turkish meanings below English suggestions. You can also toggle this during the conversation.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={suggestionsTr}
                onClick={() => setSuggestionsTr((v) => !v)}
                className={cn(
                  "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors cursor-pointer",
                  suggestionsTr
                    ? "bg-primary border-primary"
                    : "bg-muted border-border"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
                    suggestionsTr && "translate-x-5"
                  )}
                />
              </button>
            </div>

            {/* Level description */}
            <div className="w-full rounded-xl border border-primary/10 bg-primary/5 p-3.5 text-xs text-muted-foreground space-y-1">
              <p className="font-bold text-foreground flex items-center gap-1.5">
                <BarChart3 className="size-3.5 text-primary" />
                At {level} level:
              </p>
              {level === "A1" && <p>Very slow and simple speech. Plenty of Turkish hints. Only basic mistakes are corrected.</p>}
              {level === "A2" && <p>Slow and clear speech. Turkish hints when needed. Important mistakes are corrected.</p>}
              {level === "B1" && <p>Moderate pace. Few Turkish hints. Grammar and vocabulary mistakes are corrected.</p>}
              {level === "B2" && <p>Natural pace. Minimal Turkish. All mistakes plus nuance corrections.</p>}
              {level === "C1" && <p>Full natural speed. No Turkish. Subtle mistakes: word choice, context fit.</p>}
              {level === "C2" && <p>Native speed. Feedback focused on style and naturalness.</p>}
            </div>

            {/* Start Button */}
            <Button
              onClick={connect}
              disabled={isFetchingToken || (activeTab === "coach" && !coachingConfig)}
              className="size-24 rounded-full bg-primary hover:bg-primary/95 text-primary-foreground flex flex-col items-center justify-center gap-1 shadow-lg hover:scale-105 transition-all duration-300 cursor-pointer mt-2 disabled:opacity-40 disabled:scale-100 disabled:pointer-events-none"
            >
              <Mic className="size-8 animate-pulse" />
              <span className="text-[10px] uppercase font-bold tracking-wide">
                {isFetchingToken ? "..." : "Start"}
              </span>
            </Button>

            {import.meta.env.DEV && (
              <p className="text-xs text-muted-foreground bg-secondary/30 border border-border/30 rounded-lg p-3 text-center w-full">
                Developer note: LiveKit agent should be running: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary text-xs">./scripts/dev.sh voice</code>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Active Session ──
  return (
    <LiveKitRoom
      serverUrl={LIVEKIT_URL}
      token={token}
      connect
      audio
      onDisconnected={() => { setConnected(false); setToken(null); }}
      className="mx-auto w-full max-w-5xl animate-in fade-in-50 duration-300"
    >
      <RoomAudioRenderer />
      <Card className="shadow-md border-border/60">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-xl">Live English Practice</CardTitle>
          <div className="flex gap-2 justify-center mt-1.5">
            <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">{level}</Badge>
            <Badge variant="outline" className="border-muted-foreground/30 font-semibold text-muted-foreground">
              {turnMode === "manual" ? "Manual send" : "Automatic"}
            </Badge>
            <Badge variant="outline" className="max-w-[180px] truncate border-muted-foreground/30 font-semibold text-muted-foreground">
              {activeTab === "coach" && coachingConfig
                ? `Coaching: ${coachingConfig.title_tr}`
                : FLEXIBLE_MODES.find((m) => m.value === selectedScenario)?.label ?? selectedScenario}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          <VoiceAssistantUI
            onSessionEnd={handleSessionEnd}
            scenarioConfig={activeTab === "coach" ? coachingConfig : undefined}
            turnMode={turnMode}
            showSuggestionTr={suggestionsTr}
            onShowSuggestionTrChange={setSuggestionsTr}
          />
        </CardContent>
      </Card>
    </LiveKitRoom>
  );
}
