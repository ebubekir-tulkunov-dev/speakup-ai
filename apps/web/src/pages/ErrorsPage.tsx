import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ErrorsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["errors"], queryFn: api.errorQueue });
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const review = useMutation({
    mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.errorReview(id, ok),
    onSuccess: () => {
      setShowAnswer(false);
      setIdx(0);
      qc.invalidateQueries({ queryKey: ["errors"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  const items = data?.items ?? [];
  const item = items[idx];

  if (!item) {
    return (
      <div className="mx-auto max-w-lg space-y-6">
        <PageHeader title="Error Pool" description="Review incorrect answers" />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Error pool is empty — great job!
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Error Pool"
        description="Review incorrect answers"
        action={<Badge variant="secondary">{idx + 1} / {items.length}</Badge>}
      />

      <Card>
        <CardHeader>
          <Badge variant="outline" className="w-fit">{item.source_type}</Badge>
          <CardTitle className="text-lg font-normal leading-relaxed">{item.prompt}</CardTitle>
          <CardDescription>Priority: {item.priority}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAnswer && (
            <p className="rounded-lg bg-emerald-500/10 p-3 text-emerald-400 font-medium">
              Correct answer: {item.correct_answer}
            </p>
          )}
          {!showAnswer ? (
            <Button className="w-full" onClick={() => setShowAnswer(true)}>Show Answer</Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="destructive" disabled={review.isPending} onClick={() => review.mutate({ id: item.id, ok: false })}>
                Got It Wrong
              </Button>
              <Button disabled={review.isPending} onClick={() => review.mutate({ id: item.id, ok: true })}>
                Got It Right
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
