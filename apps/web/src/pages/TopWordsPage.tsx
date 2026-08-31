/** Geçici kapatıldı — gereksiz özellik. Route: ComingSoonPage (bkz. lib/disabledFeatures.ts) */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Volume2, Printer, Play, Square } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CEFR_LEVELS } from "@/lib/cefr";

const LEVELS = ["ALL", ...CEFR_LEVELS] as const;
const COUNTS = [100, 200, 300];

function speakWord(text: string) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

export function TopWordsPage() {
  const [level, setLevel] = useState("ALL");
  const [count, setCount] = useState(100);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const cancelRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ["top-words", level, count],
    queryFn: () => api.topWords(count, level),
  });

  const items = data?.items ?? [];

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      window.speechSynthesis.cancel();
    };
  }, []);

  const playAll = () => {
    if (items.length === 0) return;
    cancelRef.current = false;
    let i = 0;
    const next = () => {
      if (cancelRef.current || i >= items.length) {
        setPlayingIdx(null);
        return;
      }
      setPlayingIdx(i);
      const u = new SpeechSynthesisUtterance(items[i].lemma);
      u.lang = "en-US";
      u.onend = () => {
        i += 1;
        next();
      };
      window.speechSynthesis.speak(u);
    };
    next();
  };

  const stopAll = () => {
    cancelRef.current = true;
    window.speechSynthesis.cancel();
    setPlayingIdx(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title={`Top ${count} Words`}
        description="Polyglot tactic: read the most common words aloud every day. Print the list and carry it with you."
        action={
          <div className="flex gap-2 print:hidden">
            {playingIdx === null ? (
              <Button size="sm" variant="outline" onClick={playAll} className="gap-2" disabled={items.length === 0}>
                <Play className="size-4" /> Read All
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={stopAll} className="gap-2">
                <Square className="size-4" /> Stop
              </Button>
            )}
            <Button size="sm" onClick={() => window.print()} className="gap-2">
              <Printer className="size-4" /> Print
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <div className="flex flex-wrap gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit">
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={cn(
                "px-3 py-1 rounded-lg text-[11px] font-semibold uppercase transition-all cursor-pointer",
                level === l ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {l === "ALL" ? "All" : l}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit">
          {COUNTS.map((c) => (
            <button
              key={c}
              onClick={() => setCount(c)}
              className={cn(
                "px-3 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer",
                count === c ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-center p-6">Loading...</p>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border/40">
            {items.map((w, i) => (
              <div
                key={w.word_id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors",
                  playingIdx === i && "bg-primary/10"
                )}
              >
                <span className="text-xs font-bold text-muted-foreground w-8 shrink-0 tabular-nums">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-foreground">{w.lemma}</span>
                  <span className="text-muted-foreground"> — {w.translation_tr}</span>
                </div>
                {w.level && (
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0 print:hidden">{w.level}</Badge>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 print:hidden"
                  onClick={() => speakWord(w.lemma)}
                >
                  <Volume2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No words found at this level.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
