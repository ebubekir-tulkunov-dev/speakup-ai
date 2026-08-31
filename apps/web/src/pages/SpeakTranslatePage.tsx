import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Mic, RefreshCw, Sparkles, Volume2 } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, SpeakPromptsResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CEFR_LEVELS } from "@/lib/cefr";

const LEVELS = CEFR_LEVELS;
const RECENT_KEY = "speak-translate-recent";

const LENGTHS = [
  { words: 50, label: "Short" },
  { words: 80, label: "Medium" },
  { words: 120, label: "Long" },
];

const TOPICS = [
  { id: "daily routine", label: "Daily Routine" },
  { id: "home and family", label: "Home & Family" },
  { id: "shopping and food", label: "Shopping & Food" },
  { id: "work and school", label: "Work & School" },
  { id: "health and feelings", label: "Health & Feelings" },
  { id: "travel and city", label: "Travel & City" },
  { id: "plans and weekend", label: "Plans & Weekend" },
];

function speakEn(text: string) {
  if (!text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

function loadRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecent(texts: string[]) {
  sessionStorage.setItem(RECENT_KEY, JSON.stringify(texts.slice(0, 5)));
}

export function SpeakTranslatePage() {
  const [level, setLevel] = useState("A2");
  const [topic, setTopic] = useState(TOPICS[0].id);
  const [customTopic, setCustomTopic] = useState("");
  const [wordCount, setWordCount] = useState(80);
  const [result, setResult] = useState<SpeakPromptsResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [doneLogged, setDoneLogged] = useState(false);
  const recentRef = useRef<string[]>(loadRecent());

  const effectiveTopic = customTopic.trim() || topic;

  const generate = useMutation({
    mutationFn: () =>
      api.speakPrompts({
        level,
        topic: effectiveTopic,
        word_count: wordCount,
        exclude_texts: recentRef.current,
      }),
    onSuccess: (res) => {
      const next = [res.text_tr, ...recentRef.current.filter((t) => t !== res.text_tr)].slice(0, 5);
      recentRef.current = next;
      saveRecent(next);
      setResult(res);
      setRevealed(false);
      setDoneLogged(false);
    },
  });

  useEffect(() => {
    return () => window.speechSynthesis.cancel();
  }, []);

  const markDone = () => {
    if (!result || doneLogged) return;
    api.speakPromptsDone(result.topic_tr, wordCount).catch(() => {});
    setDoneLogged(true);
  };

  const resetToForm = () => {
    setResult(null);
    window.speechSynthesis.cancel();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Speak & Translate"
        description="You get a Turkish text with everyday vocabulary; you translate it aloud into English."
      />

      {!result ? (
        <Card>
          <CardContent className="py-6 space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/15 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mic className="size-5" />
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-foreground">How does it work?</p>
                <ol className="list-decimal list-inside text-muted-foreground space-y-0.5 text-[13px]">
                  <li>Read the Turkish text</li>
                  <li>Translate aloud into English</li>
                  <li>Reveal the answer and listen to the model translation</li>
                </ol>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Topic</p>
              <div className="flex flex-wrap gap-1.5">
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTopic(t.id);
                      setCustomTopic("");
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border",
                      !customTopic.trim() && topic === t.id
                        ? "bg-primary text-primary-foreground border-primary shadow-sm"
                        : "bg-secondary/30 text-muted-foreground border-border/40 hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-topic" className="text-xs text-muted-foreground">
                  Or write your own topic
                </Label>
                <Input
                  id="custom-topic"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder="e.g. football match, job interview, rainy bus ride"
                  className="bg-card border-border focus-visible:ring-primary/40 focus-visible:border-primary/50"
                />
                {customTopic.trim() && (
                  <p className="text-[11px] text-muted-foreground">
                    Custom topic: <span className="text-foreground font-medium">{customTopic.trim()}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Level</p>
                <div className="flex gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit">
                  {LEVELS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLevel(l)}
                      className={cn(
                        "px-3 py-1 rounded-lg text-[11px] font-semibold uppercase transition-all cursor-pointer",
                        level === l ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Text length</p>
                <div className="flex gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit">
                  {LENGTHS.map((opt) => (
                    <button
                      key={opt.words}
                      type="button"
                      onClick={() => setWordCount(opt.words)}
                      className={cn(
                        "px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer",
                        wordCount === opt.words
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || !effectiveTopic.trim()}
              className="gap-2 w-full sm:w-auto"
            >
              <Sparkles className="size-4" />
              {generate.isPending ? "Generating text..." : "Generate Turkish Text"}
            </Button>
            {generate.isError && (
              <p className="text-xs text-destructive">Could not generate text. Check the AI service.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4 animate-in fade-in-50 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="secondary" className="text-[10px] font-bold">
              {result.topic_tr}
            </Badge>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                className="gap-2"
              >
                <RefreshCw className={cn("size-3.5", generate.isPending && "animate-spin")} />
                {generate.isPending ? "Generating..." : "Different text"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetToForm}>
                Settings
              </Button>
            </div>
          </div>

          {result.tips_tr && (
            <p className="text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2 border border-border/40">
              {result.tips_tr}
            </p>
          )}

          <Card className="shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-gradient-to-br from-primary/8 via-transparent to-transparent px-6 py-8 sm:px-8 sm:py-10 space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary/70 text-center">Turkish</p>
                <p className="text-lg sm:text-xl font-medium tracking-tight text-foreground leading-relaxed text-left">
                  {result.text_tr}
                </p>
                {result.hint_tr && (
                  <p className="text-xs text-muted-foreground text-center">Hint: {result.hint_tr}</p>
                )}
              </div>

              <div className="border-t border-border/40 px-6 py-5 sm:px-8 space-y-4">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    size="sm"
                    variant={revealed ? "outline" : "default"}
                    onClick={() => setRevealed((v) => !v)}
                    className="gap-2"
                  >
                    {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {revealed ? "Hide answer" : "Show answer"}
                  </Button>
                  {revealed && (
                    <Button size="sm" variant="outline" onClick={() => speakEn(result.text_en)} className="gap-2">
                      <Volume2 className="size-3.5" /> Listen
                    </Button>
                  )}
                </div>

                {revealed ? (
                  <div className="rounded-xl bg-secondary/50 border border-border/50 px-4 py-4 space-y-3 animate-in fade-in duration-200">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground text-center">English</p>
                    <p className="text-base sm:text-lg font-medium text-foreground leading-relaxed">{result.text_en}</p>
                    {result.focus_words?.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-1.5 pt-1">
                        {result.focus_words.map((w) => (
                          <Badge key={w} variant="secondary" className="text-[10px] font-semibold">
                            {w}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-2">
                    Now translate the entire text aloud into English — then reveal the answer.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button size="sm" onClick={markDone} disabled={doneLogged}>
              {doneLogged ? "Completed" : "Finish"}
            </Button>
          </div>

          {doneLogged && (
            <p className="text-sm text-emerald-600 font-medium text-center">
              This text is complete. Added to your streak — you can generate another.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
