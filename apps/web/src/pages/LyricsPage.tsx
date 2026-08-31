/** Geçici kapatıldı — algoritma iyileştirmesi. Route: ComingSoonPage (bkz. lib/disabledFeatures.ts) */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Play, Square, Volume2 } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, LyricLine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function LyricsPage() {
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const cancelRef = useRef(false);

  const translate = useMutation({
    mutationFn: () => api.translateLyrics(input),
    onSuccess: (res) => setLines(res.lines),
  });

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      window.speechSynthesis.cancel();
    };
  }, []);

  const speakLine = (text: string, idx?: number) => {
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    if (idx !== undefined) {
      setPlayingIdx(idx);
      u.onend = () => setPlayingIdx(null);
    }
    window.speechSynthesis.speak(u);
  };

  const playAll = () => {
    const sung = lines.map((l, i) => ({ ...l, i })).filter((l) => l.en.trim());
    if (sung.length === 0) return;
    cancelRef.current = false;
    let k = 0;
    const next = () => {
      if (cancelRef.current || k >= sung.length) {
        setPlayingIdx(null);
        return;
      }
      const cur = sung[k];
      setPlayingIdx(cur.i);
      const u = new SpeechSynthesisUtterance(cur.en);
      u.lang = "en-US";
      u.onend = () => {
        k += 1;
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
    <div className="mx-auto max-w-4xl space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Lyrics Practice"
        description="Polyglot tactic: English lyrics on the left, Turkish on the right. Hum along as you listen."
      />

      {lines.length === 0 ? (
        <Card>
          <CardContent className="py-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste lyrics from a favorite English song. AI translates line by line; then follow along with text-to-speech.
            </p>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"Is this the real life?\nIs this just fantasy?\nCaught in a landslide..."}
              className="flex min-h-[200px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 leading-relaxed"
            />
            <Button onClick={() => translate.mutate()} disabled={!input.trim() || translate.isPending} className="gap-2">
              <Sparkles className="size-4" />
              {translate.isPending ? "Translating..." : "Translate Line by Line"}
            </Button>
            {translate.isError && <p className="text-xs text-destructive">Translation failed. Check the AI service.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {playingIdx === null ? (
              <Button size="sm" variant="outline" onClick={playAll} className="gap-2">
                <Play className="size-4" /> Play from Start
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={stopAll} className="gap-2">
                <Square className="size-4" /> Stop
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setLines([]); stopAll(); }}>
              New Song
            </Button>
          </div>

          <Card>
            <CardContent className="p-0 divide-y divide-border/40">
              {lines.map((l, i) => {
                if (!l.en.trim() && !l.tr.trim()) {
                  return <div key={i} className="h-4" />;
                }
                return (
                  <div
                    key={i}
                    className={cn(
                      "grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5 transition-colors",
                      playingIdx === i && "bg-primary/10"
                    )}
                  >
                    <p className={cn("text-sm font-medium", playingIdx === i ? "text-primary" : "text-foreground")}>{l.en}</p>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => speakLine(l.en, i)}>
                      <Volume2 className="size-3.5" />
                    </Button>
                    <p className="text-sm text-muted-foreground text-right">{l.tr}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <p className="text-[11px] text-muted-foreground text-center">
            Note: Real song audio is not played due to copyright; you practice pronunciation with browser speech.
          </p>
        </div>
      )}
    </div>
  );
}
