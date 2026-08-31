import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, X, Sparkles, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function CaptureWordDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lemma, setLemma] = useState("");
  const [context, setContext] = useState("");

  const capture = useMutation({
    mutationFn: () => api.captureWord(lemma.trim(), context.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vocab"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["top-words"] });
    },
  });

  const close = () => {
    setOpen(false);
    setLemma("");
    setContext("");
    capture.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lemma.trim() || capture.isPending) return;
    capture.mutate();
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full gap-2 justify-center border-primary/30 text-primary hover:bg-primary/10"
      >
        <Plus className="size-4" />
        Capture Word
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={close}>
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-3.5">
              <h3 className="font-bold text-base">Capture Word</h3>
              <Button variant="ghost" size="icon" className="size-7" onClick={close}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="p-5 space-y-4">
              {capture.data?.added || (capture.data && !capture.data.added) ? (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
                    <CheckCircle2 className="size-4" />
                    {capture.data.added ? "Word added to your review queue!" : capture.data.message}
                  </div>
                  <div className="rounded-xl border border-border/50 bg-secondary/20 p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">{capture.data.lemma}</span>
                      {capture.data.level && <Badge variant="secondary" className="text-[10px]">{capture.data.level}</Badge>}
                    </div>
                    <p className="text-sm text-primary font-medium">{capture.data.translation_tr}</p>
                    {capture.data.example && <p className="text-xs text-muted-foreground italic pt-1">"{capture.data.example}"</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setLemma(""); setContext(""); capture.reset(); }}>
                      New Word
                    </Button>
                    <Button className="flex-1" onClick={close}>Close</Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Enter an English word you heard in a show, song, or on the street. AI finds the meaning and adds it to your review list.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="cap-lemma">English Word</Label>
                    <Input
                      id="cap-lemma"
                      autoFocus
                      value={lemma}
                      onChange={(e) => setLemma(e.target.value)}
                      placeholder="e.g. overwhelmed"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cap-ctx">Context Sentence (optional)</Label>
                    <Input
                      id="cap-ctx"
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      placeholder="The sentence you heard — helps pick the right meaning"
                    />
                  </div>
                  {capture.isError && (
                    <p className="text-xs text-destructive">Could not add word. Make sure the AI service is running.</p>
                  )}
                  <Button type="submit" className="w-full gap-2" disabled={!lemma.trim() || capture.isPending}>
                    <Sparkles className="size-4" />
                    {capture.isPending ? "Finding meaning..." : "Capture & Add"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
