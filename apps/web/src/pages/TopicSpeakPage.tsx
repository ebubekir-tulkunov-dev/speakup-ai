import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  History,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, type TopicSpeakQuestion, type TopicSpeakTargetPattern, type TopicSpeakTargetWord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CEFR_LEVELS } from "@/lib/cefr";

const WORD_TYPE_TR: Record<string, string> = {
  noun: "isim",
  verb: "fiil",
  adjective: "sıfat",
  adverb: "zarf",
};

const WORD_TYPE_STYLE: Record<string, string> = {
  noun: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  verb: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  adjective: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30",
  adverb: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
};

function speakText(text: string, lang = "en-US") {
  if (!text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

function TargetPatterns({
  patterns,
  used,
  missed,
}: {
  patterns: TopicSpeakTargetPattern[];
  used?: string[];
  missed?: string[];
}) {
  if (!patterns.length) return null;
  const usedSet = new Set((used ?? []).map((p) => p.toLowerCase()));
  const missedSet = new Set((missed ?? []).map((p) => p.toLowerCase()));
  const answered = used !== undefined || missed !== undefined;

  return (
    <div className="space-y-2 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Zorunlu cümle kalıbı
      </p>
      <div className="space-y-2">
        {patterns.map((p, i) => {
          const key = (p.pattern || p.example).toLowerCase();
          const wasUsed =
            answered &&
            [...usedSet].some((u) => key.includes(u) || u.includes(key) || key.startsWith(u.slice(0, 12)));
          const wasMissed =
            answered &&
            !wasUsed &&
            ([...missedSet].some((m) => key.includes(m) || m.includes(key)) || missedSet.size > 0);
          return (
            <div
              key={`${p.pattern}-${i}`}
              className={cn(
                "rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5",
                answered && wasUsed && "ring-1 ring-emerald-500/40",
                answered && wasMissed && !wasUsed && "opacity-70",
              )}
            >
              <p className="text-sm font-medium text-foreground">{p.pattern}</p>
              {p.example && (
                <p className="text-sm text-rose-700 dark:text-rose-300 mt-1 font-medium">
                  Örn: {p.example}
                </p>
              )}
              {p.tr && <p className="text-xs text-muted-foreground mt-1">{p.tr}</p>}
              {answered && wasUsed && (
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">Kalıp kullanıldı</p>
              )}
              {answered && wasMissed && !wasUsed && (
                <p className="text-[10px] text-destructive mt-1">Bu kalıbı cevapta kullanmadın</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TargetWords({
  words,
  used,
  missed,
}: {
  words: TopicSpeakTargetWord[];
  used?: string[];
  missed?: string[];
}) {
  if (!words.length) return null;
  const usedSet = new Set((used ?? []).map((w) => w.toLowerCase()));
  const missedSet = new Set((missed ?? []).map((w) => w.toLowerCase()));

  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Kullanman gereken kelimeler
      </p>
      <div className="flex flex-wrap gap-1.5">
        {words.map((w) => {
          const key = w.lemma.toLowerCase();
          const answered = used !== undefined || missed !== undefined;
          const wasUsed = usedSet.has(key);
          const wasMissed = missedSet.has(key);
          return (
            <span
              key={`${w.lemma}-${w.type}`}
              className={cn(
                "inline-flex flex-col rounded-md border px-2.5 py-1.5 text-left",
                WORD_TYPE_STYLE[w.type] ?? "bg-muted border-border",
                answered && wasUsed && "ring-1 ring-emerald-500/50",
                answered && wasMissed && "opacity-55 line-through decoration-destructive/60",
              )}
              title={w.tr || undefined}
            >
              <span className="text-sm font-medium leading-none">{w.lemma}</span>
              <span className="text-[10px] mt-1 opacity-80">
                {WORD_TYPE_TR[w.type] ?? w.type}
                {w.tr ? ` · ${w.tr}` : ""}
                {answered && wasUsed ? " · kullanıldı" : ""}
                {answered && wasMissed ? " · eksik" : ""}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TopicSpeakPage() {
  const qc = useQueryClient();
  const [level, setLevel] = useState("B1");
  const [topic, setTopic] = useState("");
  const [days, setDays] = useState<number | "">("");
  const [current, setCurrent] = useState<TopicSpeakQuestion | null>(null);
  const [recording, setRecording] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const topicsQ = useQuery({
    queryKey: ["topic-speak-topics"],
    queryFn: api.topicSpeakTopics,
  });

  const historyQ = useQuery({
    queryKey: ["topic-speak-history", level, days],
    queryFn: () =>
      api.topicSpeakHistory({
        level,
        days: days === "" ? undefined : Number(days),
        limit: 20,
      }),
  });

  const nextQ = useMutation({
    mutationFn: () =>
      api.topicSpeakNext({
        level,
        topic: topic || undefined,
        prefer_fresh_days: days === "" ? undefined : Number(days),
      }),
    onSuccess: (q) => {
      setCurrent(q);
      setRecError(null);
      qc.invalidateQueries({ queryKey: ["topic-speak-history"] });
      speakText(q.question);
    },
  });

  const answerMut = useMutation({
    mutationFn: (blob: Blob) => {
      if (!current?.id) throw new Error("No question");
      return api.topicSpeakAnswer(current.id, blob);
    },
    onSuccess: (q) => {
      setCurrent(q);
      qc.invalidateQueries({ queryKey: ["topic-speak-history"] });
    },
    onError: (e: Error) => setRecError(e.message),
  });

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      mediaRef.current?.stop();
    };
  }, []);

  const startRecording = async () => {
    setRecError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 500) {
          setRecError("Kayıt çok kısa; tekrar deneyin.");
          return;
        }
        answerMut.mutate(blob);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setRecError("Mikrofona erişilemedi. Tarayıcı iznini kontrol edin.");
    }
  };

  const stopRecording = () => {
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  };

  const evaluation = current?.evaluation;

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Topic Speak"
        description="Seviyene göre rastgele konularda soru — sesli cevapla, Deepgram + LLM düzeltsin. Qdrant benzer soruları engeller."
      />

      <Card>
        <CardContent className="py-5 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Level</Label>
            <div className="flex flex-wrap gap-1.5">
              {CEFR_LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium border transition-colors",
                    level === l
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Topic (optional — empty = random / diverse)
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setTopic("")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs border",
                  !topic ? "bg-primary/15 border-primary/40 text-foreground" : "border-border text-muted-foreground",
                )}
              >
                Any
              </button>
              {(topicsQ.data?.items ?? []).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopic(t)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs border capitalize",
                    topic === t
                      ? "bg-primary/15 border-primary/40 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">History window (days)</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={days === "" ? "" : String(days)}
                onChange={(e) => setDays(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">All time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </div>
            <Button
              onClick={() => nextQ.mutate()}
              disabled={nextQ.isPending}
              className="gap-2"
            >
              {nextQ.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              New question
            </Button>
          </div>

          {nextQ.isError && (
            <p className="text-sm text-destructive">{(nextQ.error as Error).message}</p>
          )}
        </CardContent>
      </Card>

      {current && (
        <Card className="border-primary/25">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{current.level}</Badge>
              <Badge className="capitalize">{current.topic}</Badge>
              {current.duplicate_avoided && (
                <Badge variant="outline" className="text-xs">
                  Duplicate avoided
                </Badge>
              )}
            </div>
            <CardTitle className="text-xl leading-snug pt-2">{current.question}</CardTitle>
            {current.question_tr && (
              <CardDescription className="text-sm">{current.question_tr}</CardDescription>
            )}
            {current.hint_tr && (
              <p className="text-xs text-muted-foreground pt-1">İpucu: {current.hint_tr}</p>
            )}
            <TargetPatterns
              patterns={current.target_patterns ?? []}
              used={evaluation?.patterns_used}
              missed={evaluation?.patterns_missed}
            />
            <TargetWords
              words={current.target_words ?? []}
              used={evaluation?.words_used}
              missed={evaluation?.words_missed}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => speakText(current.question)}
              >
                <Volume2 className="size-4" />
                Hear question
              </Button>
              {!recording ? (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={startRecording}
                  disabled={answerMut.isPending || current.status === "answered"}
                >
                  <Mic className="size-4" />
                  Record answer
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="gap-1.5"
                  onClick={stopRecording}
                >
                  <MicOff className="size-4" />
                  Stop & submit
                </Button>
              )}
              {current.status === "answered" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1.5"
                  onClick={() => nextQ.mutate()}
                >
                  <RefreshCw className="size-4" />
                  Next
                </Button>
              )}
            </div>

            {(recording || answerMut.isPending) && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                {answerMut.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Transcribing (Deepgram) & correcting…
                  </>
                ) : (
                  <>
                    <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                    Recording… speak your answer in English
                  </>
                )}
              </p>
            )}
            {recError && <p className="text-sm text-destructive">{recError}</p>}

            {current.transcript && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Your transcript</p>
                <p className="text-sm">{current.transcript}</p>
              </div>
            )}

            {evaluation && (
              <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={evaluation.is_adequate ? "default" : "secondary"}>
                    {evaluation.is_adequate ? "Adequate" : "Needs work"}
                  </Badge>
                  {typeof evaluation.score === "number" && (
                    <span className="text-sm text-muted-foreground">Score {evaluation.score}/5</span>
                  )}
                </div>
                {evaluation.feedback_tr && (
                  <p className="text-sm">{evaluation.feedback_tr}</p>
                )}
                {evaluation.fluency_note_tr && (
                  <p className="text-xs text-muted-foreground">{evaluation.fluency_note_tr}</p>
                )}
                {(evaluation.corrections?.length ?? 0) > 0 && (
                  <ul className="space-y-2 text-sm">
                    {evaluation.corrections!.map((c, i) => (
                      <li key={i} className="rounded-md border bg-background p-2">
                        <span className="line-through text-muted-foreground">{c.wrong}</span>
                        {" → "}
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">{c.correct}</span>
                        {c.explanation_tr && (
                          <p className="text-xs text-muted-foreground mt-1">{c.explanation_tr}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {evaluation.improved_answer && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Improved answer</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1"
                        onClick={() => speakText(evaluation.improved_answer!)}
                      >
                        <Volume2 className="size-3.5" />
                        Listen
                      </Button>
                    </div>
                    <p className="text-sm leading-relaxed">{evaluation.improved_answer}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="size-4" />
            History
          </CardTitle>
          <CardDescription>Previously asked questions (Mongo + Qdrant date filter)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {historyQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {(historyQ.data?.items ?? []).length === 0 && !historyQ.isLoading && (
            <p className="text-sm text-muted-foreground">No questions yet.</p>
          )}
          {(historyQ.data?.items ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrent(item)}
              className="w-full text-left rounded-lg border p-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex flex-wrap gap-1.5 mb-1">
                <Badge variant="outline" className="text-[10px]">
                  {item.level}
                </Badge>
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {item.topic}
                </Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {item.asked_at ? new Date(item.asked_at).toLocaleString() : ""}
                </span>
              </div>
              <p className="text-sm line-clamp-2">{item.question}</p>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
