import { useCallback, useRef, useState } from "react";
import { AI_URL, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  knownWords: Record<string, number>;
  onMark?: (lemma: string, mastery: number) => void;
}

function tokenize(text: string): string[] {
  return text.split(/(\s+|[.,!?;:'"()\-—])/g).filter(Boolean);
}

export function InteractiveText({ content, knownWords, onMark }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const cache = useRef<Map<string, string>>(new Map());
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hoverWord, setHoverWord] = useState<{ lemma: string; translation: string } | null>(null);

  const fetchTranslation = useCallback(async (word: string) => {
    const lemma = word.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!lemma || lemma.length < 2) return;

    if (cache.current.has(lemma)) {
      setHoverWord({ lemma, translation: cache.current.get(lemma)! });
      return;
    }

    try {
      const res = await api.translate(lemma);
      let tr = res.translation_tr;
      if (!tr) {
        const aiRes = await fetch(
          `${AI_URL}/translate`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word: lemma }) },
        );
        if (aiRes.ok) {
          const data = await aiRes.json();
          tr = data.translation_tr;
        }
      }
      if (tr) {
        cache.current.set(lemma, tr);
        setHoverWord({ lemma, translation: tr });
      }
    } catch {
      setHoverWord(null);
    }
  }, []);

  const tokens = tokenize(content);

  return (
    <div className="relative leading-8 text-lg">
      {tokens.map((token, i) => {
        const isWord = /^[a-zA-Z'-]+$/.test(token);
        if (!isWord) return <span key={i}>{token}</span>;

        const lemma = token.toLowerCase();
        const mastery = knownWords[lemma] ?? 0;
        const showHint = mastery < 4;

        const wordEl = (
          <span
            className={cn(
              "cursor-pointer rounded px-0.5 transition-colors",
              mastery >= 4
                ? ""
                : mastery >= 2
                  ? "bg-amber-500/15 hover:bg-amber-500/25"
                  : "bg-primary/15 hover:bg-primary/25",
              selected === lemma && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
            onMouseEnter={() => {
              if (!showHint) return;
              clearTimeout(debounce.current);
              debounce.current = setTimeout(() => fetchTranslation(token), 150);
            }}
            onMouseLeave={() => {
              clearTimeout(debounce.current);
              setHoverWord(null);
            }}
            onClick={() => setSelected(selected === lemma ? null : lemma)}
          >
            {token}
          </span>
        );

        if (showHint && hoverWord?.lemma === lemma) {
          return (
            <Tooltip key={i} open>
              <TooltipTrigger asChild>{wordEl}</TooltipTrigger>
              <TooltipContent>{hoverWord.translation}</TooltipContent>
            </Tooltip>
          );
        }

        return <span key={i}>{wordEl}</span>;
      })}

      {selected && (
        <div className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-4">
          <span className="text-sm text-muted-foreground">"{selected}"</span>
          <Button variant="secondary" size="sm" onClick={() => { onMark?.(selected, 1); setSelected(null); }}>
            Learning
          </Button>
          <Button variant="default" size="sm" onClick={() => { onMark?.(selected, 3); setSelected(null); }}>
            Known
          </Button>
          <Button variant="outline" size="sm" onClick={() => { onMark?.(selected, 5); setSelected(null); }}>
            Mastered
          </Button>
        </div>
      )}
    </div>
  );
}
