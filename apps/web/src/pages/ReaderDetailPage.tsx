import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Clock, ChevronLeft, AlertCircle, Sparkles, CheckCircle2, XCircle, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { InteractiveText } from "@/components/reader/InteractiveText";
import { api, ReaderQuestion } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReaderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["passage", id],
    queryFn: () => api.passage(id!),
    enabled: !!id,
  });

  const getLevelBadgeClass = (lvl: string) => {
    const l = lvl.toUpperCase();
    if (l.startsWith("A")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (l.startsWith("B")) return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    if (l.startsWith("C")) return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  };

  if (isLoading || !data) return <p className="text-muted-foreground">Loading...</p>;

  // Roughly estimate word count based on spaces to calculate reading time
  const approxWordCount = data.content.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.ceil(approxWordCount / 150);

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in-50 duration-300">
      
      <div className="flex items-center gap-2">
        <Link to="/reader">
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" /> Go back
          </Button>
        </Link>
      </div>

      <PageHeader
        title={data.title}
        description={`Level: ${data.level}`}
        action={
          <Badge variant="outline" className={`${getLevelBadgeClass(data.level)} text-sm px-3 py-1`}>
            {data.level.toUpperCase()}
          </Badge>
        }
      />

      {/* Info Card - Formula Card equivalent from Tenses */}
      <Card className="bg-secondary/20 border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Clock className="size-4 text-primary" />
            <span>⏱ {readingTime} min reading time</span>
          </div>
          <div className="text-xs">
            Total: <span className="text-foreground font-semibold">{approxWordCount}</span> words
          </div>
        </CardContent>
      </Card>

      {/* Interactive Text Card */}
      <Card className="shadow-md">
        <CardContent className="pt-6">
          <InteractiveText
            content={data.content}
            knownWords={data.known_words}
            onMark={async (lemma, mastery) => {
              await api.markWord(lemma, mastery);
              qc.invalidateQueries({ queryKey: ["passage", id] });
            }}
          />
        </CardContent>
      </Card>

      {/* Comprehension Quiz */}
      <QuizSection passageId={id!} />

      {/* Vocabulary Guide - Example Explanation Card equivalent */}
      <Card className="bg-accent/20 border-border/40">
        <CardContent className="pt-4 pb-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Vocabulary Study Guide</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Hover over highlighted words in the text to see instant Turkish translations.
              Click words to update your learning status:
              <span className="text-primary font-medium"> Blue</span> = New/Unknown,
              <span className="text-amber-400 font-medium"> Yellow</span> = Learning,
              Unhighlighted = Known.
            </p>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

function QuizSection({ passageId }: { passageId: string }) {
  const [questions, setQuestions] = useState<ReaderQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const generate = useMutation({
    mutationFn: () => api.readerQuiz(passageId),
    onSuccess: (res) => {
      setQuestions(res.questions);
      setAnswers({});
      setSubmitted(false);
    },
  });

  const score = questions.reduce((acc, q, i) => acc + (answers[i] === q.answer ? 1 : 0), 0);

  const submit = () => {
    setSubmitted(true);
    api.submitReaderQuiz(passageId, score, questions.length).catch(() => {});
  };

  if (questions.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
          <ListChecks className="size-8 text-primary/60" />
          <p className="text-sm text-muted-foreground">Test your comprehension: let AI prepare a few questions.</p>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending} className="gap-2">
            <Sparkles className="size-4" />
            {generate.isPending ? "Preparing questions..." : "Create Comprehension Quiz"}
          </Button>
          {generate.isError && <p className="text-xs text-destructive">Could not generate questions. Check the AI service.</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="size-5 text-primary" />
            <CardTitle className="text-base font-bold">Comprehension Quiz</CardTitle>
          </div>
          {submitted && (
            <Badge className="bg-primary/20 text-primary border-primary/30 font-semibold">
              {score} / {questions.length} correct
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">Select the correct option for each question.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {questions.map((q, qi) => (
          <div key={qi} className="space-y-2">
            <p className="text-sm font-semibold text-foreground">{qi + 1}. {q.question}</p>
            <div className="grid gap-2">
              {q.options.map((opt, oi) => {
                const selected = answers[qi] === opt;
                const isCorrect = opt === q.answer;
                return (
                  <button
                    key={oi}
                    disabled={submitted}
                    onClick={() => setAnswers((p) => ({ ...p, [qi]: opt }))}
                    className={cn(
                      "w-full text-left px-3.5 py-2.5 rounded-xl border text-sm transition-all flex items-center justify-between gap-2 cursor-pointer",
                      !submitted && selected && "border-primary bg-primary/10 text-foreground font-medium",
                      !submitted && !selected && "border-border/60 bg-secondary/20 text-muted-foreground hover:border-primary/40",
                      submitted && isCorrect && "border-emerald-500/60 bg-emerald-500/10 text-emerald-600 font-semibold",
                      submitted && selected && !isCorrect && "border-destructive/50 bg-destructive/10 text-destructive font-semibold",
                      submitted && !isCorrect && !selected && "opacity-50 border-border/40"
                    )}
                  >
                    <span>{opt}</span>
                    {submitted && isCorrect && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
                    {submitted && selected && !isCorrect && <XCircle className="size-4 shrink-0 text-destructive" />}
                  </button>
                );
              })}
            </div>
            {submitted && q.explanation_tr && (
              <p className="text-xs text-muted-foreground italic bg-secondary/20 rounded-lg px-3 py-2 border border-border/30">{q.explanation_tr}</p>
            )}
          </div>
        ))}

        {!submitted ? (
          <Button onClick={submit} disabled={Object.keys(answers).length < questions.length} className="w-full">
            Check Answers
          </Button>
        ) : (
          <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending} className="w-full gap-2">
            <Sparkles className="size-4" /> Generate New Questions
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
