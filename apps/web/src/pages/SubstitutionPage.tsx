import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Shuffle, Sparkles, Volume2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, SubstitutionDrill } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function speak(text: string) {
  if (!text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

export function SubstitutionPage() {
  const [word, setWord] = useState("");
  const [drill, setDrill] = useState<SubstitutionDrill | null>(null);

  const { data } = useQuery({ queryKey: ["learned-vocab"], queryFn: api.learnedVocab });
  const learned = data?.items ?? [];

  const gen = useMutation({
    mutationFn: (w: string) => api.substitutionDrill(w),
    onSuccess: (res, w) => {
      setDrill(res);
      api.substitutionDone(w).catch(() => {});
    },
  });

  const run = (w: string) => {
    const clean = w.trim();
    if (!clean) return;
    setWord(clean);
    gen.mutate(clean);
  };

  const randomLearned = () => {
    if (learned.length === 0) return;
    const w = learned[Math.floor(Math.random() * learned.length)].lemma;
    run(w);
  };

  const highlightSlot = (sentence: string, target: string) => {
    if (!target) return sentence;
    const idx = sentence.toLowerCase().indexOf(target.toLowerCase());
    if (idx === -1) return sentence;
    return (
      <>
        {sentence.slice(0, idx)}
        <span className="text-primary font-bold underline decoration-dotted">{sentence.slice(idx, idx + target.length)}</span>
        {sentence.slice(idx + target.length)}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Link to="/vocab/practice">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <PageHeader
          title="Word Substitution Drill"
          description="Polyglot tactic: learn one pattern, swap in different words to generate new sentences."
        />
      </div>

      <Card>
        <CardContent className="py-5 space-y-3">
          <div className="flex gap-2">
            <Input
              value={word}
              onChange={(e) => setWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run(word)}
              placeholder="Enter a word (e.g. decide) to generate a pattern"
            />
            <Button onClick={() => run(word)} disabled={!word.trim() || gen.isPending} className="gap-2 shrink-0">
              <Sparkles className="size-4" />
              {gen.isPending ? "..." : "Generate"}
            </Button>
          </div>
          {learned.length > 0 && (
            <Button variant="outline" size="sm" onClick={randomLearned} disabled={gen.isPending} className="gap-2">
              <Shuffle className="size-4" /> Pick randomly from my learned words
            </Button>
          )}
          {gen.isError && <p className="text-xs text-destructive">Could not generate drill. Check the AI service.</p>}
        </CardContent>
      </Card>

      {drill && (
        <div className="space-y-4 animate-in fade-in-50 duration-300">
          {/* Pattern */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary">Pattern</CardTitle>
                <Button size="icon" variant="ghost" className="size-7" onClick={() => speak(drill.base_sentence)}>
                  <Volume2 className="size-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className="text-lg font-bold">{drill.pattern}</p>
              <p className="text-xs text-muted-foreground italic">{drill.translation_tr}</p>
              {drill.base_sentence && (
                <p className="text-sm text-foreground pt-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold mr-2">Example:</span>
                  {drill.base_sentence}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Variants */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">
              Swap different words into the same pattern:
            </p>
            {drill.variants.map((v, i) => (
              <Card key={i} className="hover:border-primary/30 transition-colors">
                <CardContent className="py-3 flex items-start gap-3">
                  <Badge variant="secondary" className="mt-0.5 shrink-0 font-semibold">{v.word}</Badge>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">{highlightSlot(v.sentence_en, v.word)}</p>
                    <p className="text-xs text-muted-foreground italic">{v.sentence_tr}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => speak(v.sentence_en)}>
                    <Volume2 className="size-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button variant="outline" onClick={() => run(word)} disabled={gen.isPending} className="w-full gap-2">
            <RefreshCw className="size-4" /> Generate a new pattern with the same word
          </Button>
        </div>
      )}
    </div>
  );
}
