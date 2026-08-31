/** Geçici kapatıldı — algoritma iyileştirmesi. Route: ComingSoonPage (bkz. lib/disabledFeatures.ts) */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles, Volume2, CheckCircle2, CalendarClock, History, Save } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, JournalCheckResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function speak(text: string) {
  if (!text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  window.speechSynthesis.speak(u);
}

type Section = "future" | "past";

export function JournalPage() {
  const qc = useQueryClient();
  const [future, setFuture] = useState("");
  const [past, setPast] = useState("");
  const [results, setResults] = useState<Record<Section, JournalCheckResult | null>>({
    future: null,
    past: null,
  });

  const { data: history } = useQuery({ queryKey: ["journal-history"], queryFn: api.journalHistory });

  const check = useMutation({
    mutationFn: ({ section, text }: { section: Section; text: string }) =>
      api.journalCheck(text).then((res) => ({ section, res })),
    onSuccess: ({ section, res }) => {
      setResults((prev) => ({ ...prev, [section]: res }));
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.saveJournal({
        future_text: future,
        past_text: past,
        corrections: [...(results.future?.corrections ?? []), ...(results.past?.corrections ?? [])],
        feedback_tr: results.future?.feedback_tr ?? results.past?.feedback_tr ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal-history"] }),
  });

  const sections: { key: Section; title: string; hint: string; tenseBadge: string; value: string; set: (v: string) => void; placeholder: string }[] = [
    {
      key: "future",
      title: "What will you do tomorrow?",
      hint: "Write in future tense (I will / I'm going to ...)",
      tenseBadge: "Future Tense",
      value: future,
      set: setFuture,
      placeholder: "Tomorrow, I am going to wake up early and study English for one hour...",
    },
    {
      key: "past",
      title: "What did you do today?",
      hint: "Write in past tense (I did / I went ...)",
      tenseBadge: "Past Tense",
      value: past,
      set: setPast,
      placeholder: "Today, I woke up at 8 a.m. and I went to work by bus...",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Journal"
        description="Polyglot tactic: write about tomorrow (future tense), then today (past tense), let AI correct, read aloud."
        action={
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!future.trim() && !past.trim())} className="gap-2">
            <Save className="size-4" />
            Save Journal
          </Button>
        }
      />

      {save.isSuccess && (
        <p className="text-sm text-emerald-500 font-medium text-center">Today's journal saved. Streak continues.</p>
      )}

      {sections.map((s) => {
        const res = results[s.key];
        return (
          <Card key={s.key} className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-primary" />
                  <CardTitle className="text-base font-bold">{s.title}</CardTitle>
                </div>
                <Badge variant="secondary" className="text-[10px] font-bold">{s.tenseBadge}</Badge>
              </div>
              <CardDescription className="text-xs">{s.hint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={s.value}
                onChange={(e) => s.set(e.target.value)}
                placeholder={s.placeholder}
                className="flex min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 leading-relaxed"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => check.mutate({ section: s.key, text: s.value })}
                  disabled={!s.value.trim() || check.isPending}
                  className="gap-2"
                >
                  <Sparkles className="size-3.5" />
                  {check.isPending && check.variables?.section === s.key ? "AI is checking..." : "Check with AI"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => speak(s.value)} disabled={!s.value.trim()} className="gap-2">
                  <Volume2 className="size-3.5" />
                  Read Aloud
                </Button>
              </div>

              {res && (
                <div className="space-y-3 pt-2 border-t border-border/40 animate-in fade-in-50 duration-300">
                  {res.corrections.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Corrections</p>
                      {res.corrections.map((c, i) => (
                        <div key={i} className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm space-y-1">
                          <p className="font-semibold">
                            <span className="text-destructive line-through mr-2">{c.wrong}</span>
                            <span className="text-emerald-500">→ {c.correct}</span>
                          </p>
                          <p className="text-xs text-muted-foreground/90">{c.explanation_tr}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium">
                      <CheckCircle2 className="size-4" /> No errors found, great!
                    </div>
                  )}

                  {res.improved_text && (
                    <div className="bg-secondary/35 border border-border/30 rounded-xl p-4 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Corrected Version</p>
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => speak(res.improved_text)}>
                          <Volume2 className="size-3.5" />
                        </Button>
                      </div>
                      <p className="text-sm font-medium italic text-foreground leading-relaxed">{res.improved_text}</p>
                    </div>
                  )}

                  {res.feedback_tr && (
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
                      <p className="text-xs leading-relaxed text-foreground/90">{res.feedback_tr}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {history && history.items.length > 0 && (
        <Card className="border-border/50 bg-secondary/10">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-bold">Past Journals</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.items.map((h) => (
              <div key={h.id} className={cn("rounded-lg border border-border/40 bg-card/50 p-3 space-y-1")}>
                <p className="text-[11px] font-bold text-primary">{h.entry_date}</p>
                {h.future_text && <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Tomorrow:</span> {h.future_text}</p>}
                {h.past_text && <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Today:</span> {h.past_text}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
