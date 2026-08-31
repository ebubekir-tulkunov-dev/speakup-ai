/** Geçici kapatıldı — algoritma iyileştirmesi. Route: ComingSoonPage (bkz. lib/disabledFeatures.ts) */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export function TenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["tense", id], queryFn: () => api.tense(id!), enabled: !!id });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; correct?: string }>>({});

  const generate = useMutation({
    mutationFn: () => api.generateTenseLesson(id!, 5),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tense", id] });
      setAnswers({});
      setResults({});
    },
  });

  const submit = useMutation({
    mutationFn: ({ exId, answer }: { exId: string; answer: string }) => api.submitExercise(exId, answer),
    onSuccess: (res, vars) => {
      setResults((r) => ({ ...r, [vars.exId]: { ok: res.is_correct, correct: res.correct_answer ?? undefined } }));
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["errors"] });
    },
  });

  if (isLoading || !data) return <p className="text-muted-foreground">Loading...</p>;

  const lesson = data.ai_lesson;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={data.name_en}
        description={data.name_tr}
        action={
          <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Sparkles className="size-4" />
            {generate.isPending ? "Generating..." : "AI Lesson + Exercises"}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <code className="text-sm text-primary">{data.formula}</code>
          <CardDescription className="pt-2">{data.description_tr}</CardDescription>
        </CardHeader>
      </Card>

      {lesson && (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">AI Lesson</CardTitle>
              <Badge>AI</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="leading-relaxed">{lesson.lesson_tr}</p>
            {lesson.tips_tr?.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Tips</p>
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {lesson.tips_tr.map((tip, i) => <li key={i}>{tip}</li>)}
                </ul>
              </div>
            )}
            {lesson.common_mistakes?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Common Mistakes</p>
                {lesson.common_mistakes.map((m, i) => (
                  <div key={i} className="rounded-lg bg-destructive/10 p-3 text-sm">
                    <p><span className="text-destructive line-through">{m.wrong}</span> → <span className="text-emerald-400">{m.correct}</span></p>
                    <p className="mt-1 text-muted-foreground">{m.explanation_tr}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Examples</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.examples.map((ex, i) => (
            <div key={i}>
              <Badge variant="outline" className="mb-2">{ex.type}</Badge>
              <p className="font-medium">{ex.en}</p>
              <p className="text-sm text-muted-foreground">{ex.tr}</p>
              {i < data.examples.length - 1 && <Separator className="mt-4" />}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Exercises</h3>
          {generate.isSuccess && (
            <span className="text-sm text-emerald-400">+{generate.data?.exercises_added} AI exercises added</span>
          )}
        </div>
        {data.exercises.length === 0 && !lesson && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No exercises yet. Click the &quot;AI Lesson + Exercises&quot; button to get started.
            </CardContent>
          </Card>
        )}
        {data.exercises.map((ex) => (
          <Card key={ex.id}>
            <CardHeader>
              <CardTitle className="text-base font-normal">{ex.prompt}</CardTitle>
              {ex.hint_tr && <CardDescription>Hint: {ex.hint_tr}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-3">
              {ex.options.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {ex.options.map((opt) => (
                    <Button key={opt} variant="outline" size="sm" disabled={!!results[ex.id]} onClick={() => submit.mutate({ exId: ex.id, answer: opt })}>
                      {opt}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input value={answers[ex.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [ex.id]: e.target.value }))} disabled={!!results[ex.id]} placeholder="Your answer..." />
                  <Button disabled={!!results[ex.id] || !answers[ex.id]} onClick={() => submit.mutate({ exId: ex.id, answer: answers[ex.id] })}>
                    Check
                  </Button>
                </div>
              )}
              {results[ex.id] && (
                <div className={`flex items-center gap-2 text-sm ${results[ex.id].ok ? "text-emerald-400" : "text-destructive"}`}>
                  {results[ex.id].ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  {results[ex.id].ok ? "Correct!" : `Incorrect. Correct answer: ${results[ex.id].correct}`}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {data.exercises.length > 0 && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="gap-2 w-full max-w-xs"
            >
              <Sparkles className="size-4" />
              {generate.isPending ? "Generating new exercises..." : "Generate New Exercises"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
