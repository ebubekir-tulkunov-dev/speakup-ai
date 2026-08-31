import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Play, Languages, Mic, Sparkles, AlertTriangle, Check, BookOpen, Plus, Sparkle, Minimize2, Maximize2, MessageSquarePlus, Trash2, PanelLeftClose, PanelLeft } from "lucide-react";
import { api, streamChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TENSE,
  FREE_CHAT_SCENARIO,
  NEW_CHAT_TITLE,
  displayChatTitle,
  displayScenario,
  displayTense,
  isDefaultTense,
  isFreeChatScenario,
  normalizeScenario,
  normalizeTense,
} from "@/lib/chatLabels";

interface Correction {
  wrong: string;
  correct: string;
  rule: string;
  explanation_tr: string;
}

interface ExtendedChatMessage {
  role: "user" | "assistant";
  content: string;
  correction_tr?: string | null;
  translation_tr?: string | null;
  corrections?: Correction[];
  newWords?: string[];
  fluencyNote?: string;
}

const COLLAPSE_AT = 280;
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const FREE_CHAT_SUGGESTIONS = [
  "What is your dream vacation spot?",
  "I would like to tell you about my day.",
  "Can you correct my grammar mistakes?",
  "Suggest a fun topic to discuss.",
];

const suggestionsMap: Record<string, string[]> = {
  [FREE_CHAT_SCENARIO]: FREE_CHAT_SUGGESTIONS,
  "Serbest sohbet": FREE_CHAT_SUGGESTIONS,
  general: [
    "Hello, nice to meet you!",
    "What should we talk about today?",
    "Can you repeat that, please?",
    "I want to practice my English tenses."
  ]
};

function mapMessages(raw: Array<{
  role: "user" | "assistant";
  content: string;
  correction_tr?: string | null;
  translation_tr?: string | null;
  corrections?: Correction[];
  new_words?: string[];
  fluency_note?: string | null;
}>): ExtendedChatMessage[] {
  return raw.map((m) => ({
    role: m.role,
    content: m.content,
    correction_tr: m.correction_tr,
    translation_tr: m.translation_tr,
    corrections: m.corrections,
    newWords: m.new_words,
    fluencyNote: m.fluency_note ?? undefined,
  }));
}

export function ChatPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get("session");
  const scenarioParam = normalizeScenario(params.get("scenario") ?? FREE_CHAT_SCENARIO);
  const tenseParam = normalizeTense(params.get("tense") ?? DEFAULT_TENSE);
  const levelParam = (params.get("level") ?? "B1").toUpperCase();
  const mode = isFreeChatScenario(scenarioParam) ? "free" : "scenario";

  const [level, setLevelState] = useState(levelParam);
  const [scenario, setScenario] = useState(scenarioParam);
  const [tense, setTense] = useState(tenseParam);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [messages, setMessages] = useState<ExtendedChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showTranslation, setShowTranslation] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [translating, setTranslating] = useState<Record<number, boolean>>({});
  const [suggestions, setSuggestions] = useState(suggestionsMap[scenarioParam] || suggestionsMap.general);
  const [learningWords, setLearningWords] = useState<Record<string, boolean>>({});
  const [addedWords, setAddedWords] = useState<Record<string, boolean>>({});
  const [sessionTitle, setSessionTitle] = useState(NEW_CHAT_TITLE);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bootstrappedRef = useRef(false);

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: api.chatSessions,
  });
  const sessions = sessionsData?.items ?? [];

  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: ["chat-session", sessionId],
    queryFn: () => api.getChatSession(sessionId!),
    enabled: !!sessionId,
  });

  // Bootstrap: open latest session or create a new one
  useEffect(() => {
    if (bootstrappedRef.current || sessionsLoading) return;
    if (sessionId) {
      bootstrappedRef.current = true;
      return;
    }
    bootstrappedRef.current = true;
    const latest = sessions[0];
    if (latest) {
      const next = new URLSearchParams(params);
      next.set("session", latest.id);
      if (!params.get("level")) next.set("level", latest.level || "B1");
      setParams(next, { replace: true });
    } else {
      void createNewSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsLoading, sessions, sessionId]);

  // Load selected session into local state
  useEffect(() => {
    if (!activeSession) return;
    setMessages(mapMessages(activeSession.messages));
    setScenario(normalizeScenario(activeSession.scenario));
    setTense(normalizeTense(activeSession.tense));
    setLevelState((activeSession.level || "B1").toUpperCase());
    setSessionTitle(displayChatTitle(activeSession.title || NEW_CHAT_TITLE));
    setShowTranslation({});
    setExpanded({});
    setSuggestions(
      suggestionsMap[normalizeScenario(activeSession.scenario)] || suggestionsMap.general,
    );
    setAddedWords({});
  }, [activeSession]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (!streaming) inputRef.current?.focus();
  }, [streaming]);

  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus());

  const setLevel = (next: string) => {
    setLevelState(next);
    const updated = new URLSearchParams(params);
    updated.set("level", next);
    setParams(updated, { replace: true });
    if (sessionId) {
      api.saveChatSession(sessionId, {
        messages: messages.map(toApiMessage),
        level: next,
      }).then(() => qc.invalidateQueries({ queryKey: ["chat-sessions"] })).catch(() => {});
    }
  };

  const toApiMessage = (m: ExtendedChatMessage) => ({
    role: m.role,
    content: m.content,
    correction_tr: m.correction_tr || null,
    translation_tr: m.translation_tr || null,
    corrections: m.corrections ?? [],
    new_words: m.newWords ?? [],
    fluency_note: m.fluencyNote || null,
  });

  const persist = async (next: ExtendedChatMessage[]) => {
    if (!sessionId) return;
    try {
      const saved = await api.saveChatSession(sessionId, {
        messages: next.map(toApiMessage),
        level,
        scenario,
        tense,
        mode,
      });
      setSessionTitle(displayChatTitle(saved.title));
      qc.invalidateQueries({ queryKey: ["chat-sessions"] });
    } catch {
      // quiet
    }
  };

  const createNewSession = async () => {
    const created = await api.createChatSession({
      scenario: scenarioParam,
      tense: tenseParam,
      mode,
      level: levelParam,
    });
    qc.invalidateQueries({ queryKey: ["chat-sessions"] });
    const next = new URLSearchParams();
    next.set("session", created.id);
    next.set("level", created.level || levelParam);
    if (!isFreeChatScenario(scenarioParam)) next.set("scenario", scenarioParam);
    if (!isDefaultTense(tenseParam)) next.set("tense", tenseParam);
    setParams(next, { replace: true });
    setMessages([]);
    setSessionTitle(displayChatTitle(created.title));
    focusInput();
  };

  const openSession = (id: string) => {
    if (id === sessionId) return;
    const next = new URLSearchParams(params);
    next.set("session", id);
    setParams(next, { replace: true });
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteChatSession(id),
    onSuccess: async (_res, id) => {
      qc.removeQueries({ queryKey: ["chat-session", id] });
      const refreshed = await qc.fetchQuery({ queryKey: ["chat-sessions"], queryFn: api.chatSessions });
      if (id === sessionId) {
        const next = new URLSearchParams(params);
        const fallback = refreshed.items.find((s) => s.id !== id);
        if (fallback) {
          next.set("session", fallback.id);
          setParams(next, { replace: true });
        } else {
          next.delete("session");
          setParams(next, { replace: true });
          bootstrappedRef.current = false;
          void createNewSession();
        }
      }
    },
    onSettled: () => setDeleteTarget(null),
  });

  const requestDelete = (id: string, title?: string) => {
    setDeleteTarget({ id, title: title || "this chat" });
  };

  const send = async (overrideText?: string) => {
    const textToSend = overrideText || input;
    if (!textToSend.trim() || streaming) return;
    
    const userMsg = textToSend.trim();
    setInput("");
    focusInput();
    const prior = messages;
    const withUser: ExtendedChatMessage[] = [...prior, { role: "user", content: userMsg }];
    setMessages(withUser);
    setStreaming(true);

    let assistant = "";
    let parsedFeedback: {
      corrections?: Correction[];
      new_words_used?: string[];
      fluency_note?: string;
    } | null = null;
    
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    await streamChat(
      userMsg,
      prior.map(m => ({ role: m.role, content: m.content })),
      { scenario, tense, mode, level },
      (token) => {
        assistant += token;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            role: "assistant",
            content: assistant,
            newWords: parsedFeedback?.new_words_used,
            fluencyNote: parsedFeedback?.fluency_note,
          };
          return next;
        });
      },
      () => {
        // legacy correction event — ignored for display; structured feedback handles errors
      },
      () => {
        setStreaming(false);
        setMessages((prev) => {
          const final = prev.map((m, i) => {
            if (i === prev.length - 1) {
              return {
                role: "assistant" as const,
                content: assistant,
                translation_tr: m.translation_tr,
                newWords: parsedFeedback?.new_words_used,
                fluencyNote: parsedFeedback?.fluency_note,
              };
            }
            // Attach grammar corrections to the user message that just preceded the assistant
            if (i === prev.length - 2 && m.role === "user" && parsedFeedback?.corrections) {
              return { ...m, corrections: parsedFeedback.corrections };
            }
            return m;
          });
          void persist(final);
          return final;
        });

        api.chatSuggestions(assistant, userMsg, scenario, level)
          .then((res) => {
            if (res.suggestions && res.suggestions.length > 0) {
              setSuggestions(res.suggestions);
            }
          })
          .catch(() => {});
      },
      (err) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: `Error: ${err}` };
          return next;
        });
        setStreaming(false);
      },
      (feedback) => {
        parsedFeedback = feedback;
        setMessages((prev) => {
          const next = [...prev];
          if (next.length >= 2) {
            next[next.length - 2] = {
              ...next[next.length - 2],
              corrections: feedback.corrections,
            };
          }
          next[next.length - 1] = {
            ...next[next.length - 1],
            newWords: feedback.new_words_used,
            fluencyNote: feedback.fluency_note,
          };
          return next;
        });
      }
    );
  };

  const playText = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  };

  const toggleExpand = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleTranslation = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const msg = messages[idx];
    if (!msg?.content) return;

    // Already visible → hide
    if (showTranslation[idx]) {
      setShowTranslation((prev) => ({ ...prev, [idx]: false }));
      return;
    }

    // Need to fetch translation once
    if (!msg.translation_tr) {
      setTranslating((prev) => ({ ...prev, [idx]: true }));
      try {
        const res = await api.translateText(msg.content);
        const translation = res.translation?.trim() || "";
        setMessages((prev) => {
          const next = prev.map((m, i) => (i === idx ? { ...m, translation_tr: translation } : m));
          void persist(next);
          return next;
        });
      } catch (err) {
        console.error("Translation failed:", err);
      } finally {
        setTranslating((prev) => ({ ...prev, [idx]: false }));
      }
    }
    setShowTranslation((prev) => ({ ...prev, [idx]: true }));
  };

  const learnWord = async (word: string) => {
    if (addedWords[word] || learningWords[word]) return;
    
    setLearningWords(prev => ({ ...prev, [word]: true }));
    try {
      // 1. Translate the word
      const transRes = await api.translate(word);
      const translation = transRes.translation_tr || "word";
      
      // 2. Add to vocab list
      await api.addVocabWord({
        lemma: word,
        translation_tr: translation,
        word_type: "noun", // Default, will be auto-categorized or updated by backend
        level: level,
        example: `Added from conversation during scenario: ${scenario}`
      });

      setAddedWords(prev => ({ ...prev, [word]: true }));
    } catch (e) {
      console.error("Failed to add word:", e);
    } finally {
      setLearningWords(prev => ({ ...prev, [word]: false }));
    }
  };

  return (
    <div className="-m-6 md:-m-10 flex h-[calc(100dvh-3.5rem-4rem)] md:h-dvh animate-in fade-in-50 duration-300">
      {/* Sessions sidebar */}
      <aside
        className={cn(
          "shrink-0 border-r border-border/60 bg-secondary/20 flex flex-col transition-all overflow-hidden",
          sidebarOpen ? "w-64" : "w-0 border-0"
        )}
      >
        <div className="p-3 border-b border-border/50 space-y-2">
          <Button className="w-full gap-2 justify-start" size="sm" onClick={() => void createNewSession()}>
            <MessageSquarePlus className="size-4" />
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Recent
          </p>
          {sessionsLoading && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Loading...</p>
          )}
          {!sessionsLoading && sessions.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No chats yet.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex items-center gap-1.5 rounded-lg py-2 pl-1.5 pr-2 transition-colors",
                s.id === sessionId ? "bg-primary/10 text-foreground" : "hover:bg-secondary/70 text-muted-foreground"
              )}
            >
              <button
                type="button"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive hover:text-white"
                disabled={deleteMut.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  requestDelete(s.id, displayChatTitle(s.title));
                }}
                title="Delete chat"
                aria-label="Delete chat"
              >
                <Trash2 className="size-3.5" strokeWidth={2.25} />
              </button>
              <button type="button" className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => openSession(s.id)}>
                <p className="text-xs font-semibold truncate text-foreground">{displayChatTitle(s.title)}</p>
                <p className="text-[10px] truncate opacity-70">
                  {s.preview || displayScenario(s.scenario)}
                </p>
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact top bar */}
        <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/50 bg-background px-3 py-2 md:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            title={sidebarOpen ? "Hide panel" : "Show chats"}
          >
            {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
          </button>
          <h1 className="text-sm font-bold tracking-tight shrink-0 max-w-[10rem] truncate" title={sessionTitle}>
            {displayChatTitle(sessionTitle)}
          </h1>
          <div className="flex flex-wrap gap-1 p-0.5 bg-secondary/40 rounded-lg border border-border/40">
            {CEFR_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                className={cn(
                  "px-2 py-1 rounded-md text-[11px] font-semibold uppercase transition-all cursor-pointer",
                  level === lvl
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                )}
              >
                {lvl}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
              {displayScenario(scenario)}
            </Badge>
            {!isDefaultTense(tense) && (
              <Badge variant="outline" className="text-[10px]">{displayTense(tense)}</Badge>
            )}
            <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20 text-[10px]">Online</Badge>
            {sessionId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                disabled={deleteMut.isPending}
                onClick={() => requestDelete(sessionId, sessionTitle)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 py-0 shadow-none bg-background">
          <CardContent className="flex flex-1 flex-col p-0 overflow-hidden bg-background">
            <ScrollArea className="flex-1 px-4 py-4 md:px-6 md:py-5 bg-secondary/15">
              <div className="space-y-6">
                {(sessionsLoading || sessionLoading) && !messages.length && (
                  <p className="py-12 text-center text-muted-foreground text-sm">Loading chat...</p>
                )}

                {!sessionLoading && messages.length === 0 && (
                  <div className="py-10 text-center max-w-md mx-auto space-y-2">
                    <Sparkles className="size-7 text-primary/60 mx-auto animate-pulse" />
                    <p className="text-sm font-semibold text-foreground">Start Chatting</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Write in English or use the suggestions below. Past chats are kept in the left panel.
                    </p>
                  </div>
                )}

              {messages.map((m, i) => {
                const isUser = m.role === "user";
                const isLong = m.content.length > COLLAPSE_AT;
                // Default: show full message; user can collapse with "Küçült"
                const isExpanded = expanded[i] ?? true;
                const displayText = isExpanded || !isLong
                  ? m.content
                  : `${m.content.slice(0, COLLAPSE_AT).trimEnd()}…`;

                return (
                  <div key={i} className={cn("flex flex-col gap-2 w-full", isUser ? "items-end" : "items-start")}>
                    
                    {/* Speech Bubble */}
                    <div className={cn(
                      "rounded-2xl px-4 py-3 text-sm shadow-2xs max-w-[min(42rem,85%)] border transition-all leading-relaxed",
                      isUser
                        ? "bg-[#4f46e5] text-white border-indigo-600 rounded-tr-none font-medium"
                        : "bg-white text-[#1e1b4b] border-border/60 rounded-tl-none"
                    )}>
                      {displayText || (streaming && i === messages.length - 1 ? "..." : "")}

                      {/* Translation Block */}
                      {showTranslation[i] && m.translation_tr && (
                        <div className={cn(
                          "mt-2 text-xs border-t pt-2 animate-in fade-in duration-200",
                          isUser ? "border-white/30 text-indigo-100" : "border-border/40 text-muted-foreground"
                        )}>
                          {m.translation_tr}
                        </div>
                      )}
                    </div>

                    {/* Corrections block right below user message */}
                    {isUser && m.corrections && m.corrections.length > 0 && (
                      <div className="space-y-1.5 w-full max-w-[80%] mt-1 animate-in fade-in duration-300">
                        {m.corrections.map((c, idx) => (
                          <div key={idx} className="rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-foreground shadow-2xs">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="line-through text-red-500/80">{c.wrong}</span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-semibold text-emerald-700">{c.correct}</span>
                                  {c.rule && (
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-300 text-amber-800">{c.rule}</Badge>
                                  )}
                                </div>
                                <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">{c.explanation_tr}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* New words block under assistant response */}
                    {!isUser && m.newWords && m.newWords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-2 mt-1 animate-in fade-in duration-300">
                        <span className="text-[10px] text-muted-foreground font-bold uppercase flex items-center gap-1 mt-1 mr-1">
                          <BookOpen className="size-3 text-blue-500" /> New Words:
                        </span>
                        {m.newWords.map((word, wIdx) => {
                          const isAdded = addedWords[word];
                          const isAdding = learningWords[word];
                          return (
                            <Badge 
                              key={wIdx} 
                              variant={isAdded ? "secondary" : "outline"} 
                              className={cn(
                                "text-[11px] px-2 py-0.5 cursor-pointer hover:bg-secondary transition-all",
                                isAdded ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "border-blue-200 text-blue-700"
                              )}
                              onClick={() => learnWord(word)}
                            >
                              {word}
                              {isAdding ? (
                                <span className="ml-1 animate-spin size-2.5 border-t-2 border-primary rounded-full" />
                              ) : isAdded ? (
                                <Check className="size-3 ml-1 text-emerald-600" />
                              ) : (
                                <Plus className="size-3 ml-1 opacity-60 hover:opacity-100" />
                              )}
                            </Badge>
                          );
                        })}
                      </div>
                    )}

                    {/* Actions on EVERY message */}
                    {m.content && !(streaming && i === messages.length - 1 && !isUser) && (
                      <div className={cn(
                        "flex items-center gap-3 text-[11px] text-primary/80 font-bold tracking-wide uppercase",
                        isUser ? "pr-2" : "pl-2"
                      )}>
                        <button
                          onClick={(e) => playText(m.content, e)}
                          className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                        >
                          <Play className="size-3 fill-primary/10" /> Listen
                        </button>
                        <button
                          onClick={(e) => toggleTranslation(i, e)}
                          disabled={translating[i]}
                          className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Languages className="size-3" />
                          {translating[i] ? "Translating..." : showTranslation[i] ? "Hide" : "Translate"}
                        </button>
                        {isLong && (
                          <button
                            onClick={(e) => toggleExpand(i, e)}
                            className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                          >
                            {isExpanded ? (
                              <><Minimize2 className="size-3" /> Collapse</>
                            ) : (
                              <><Maximize2 className="size-3" /> Full text</>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Contextual Suggestions pills */}
          {suggestions.length > 0 && !streaming && (
            <div className="px-5 py-3 border-t bg-secondary/10 shrink-0">
              <p className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase mb-2 flex items-center gap-1">
                <Sparkle className="size-3 text-amber-500 animate-spin" /> Dynamic Suggestions
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => send(s)}
                    className="bg-white border border-border/80 hover:bg-secondary hover:border-primary/40 transition-all rounded-full px-3.5 py-1.5 text-xs font-semibold text-foreground cursor-pointer shadow-3xs"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Box */}
          <div className="flex items-center gap-2 border-t p-4 bg-white shrink-0">
            <Input
              ref={inputRef}
              placeholder="Write in English..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={streaming}
              autoFocus
              className="bg-secondary/20 border-border focus-visible:ring-primary/30 focus-visible:border-primary/50 text-sm py-5"
            />
            
            <Link to="/voice">
              <Button variant="outline" size="icon" className="size-10 rounded-full border-primary/20 text-primary hover:bg-primary hover:text-white shrink-0 cursor-pointer">
                <Mic className="size-4" />
              </Button>
            </Link>

            <Button onClick={() => send()} disabled={streaming || !input.trim() || !sessionId} size="icon" className="size-10 rounded-full bg-primary hover:bg-indigo-700 text-white shrink-0 cursor-pointer shadow-sm">
              <Send className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete chat?"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" will be permanently deleted. This action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleteMut.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMut.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
