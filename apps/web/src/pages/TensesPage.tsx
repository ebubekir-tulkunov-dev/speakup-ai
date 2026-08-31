/** Geçici kapatıldı — algoritma iyileştirmesi. Route: ComingSoonPage (bkz. lib/disabledFeatures.ts) */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const categoryStyles: Record<string, { label: string; text: string; badge: string; bg: string; border: string }> = {
  present: {
    label: "Present Tense Group (Present)",
    text: "text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    bg: "hover:bg-emerald-500/5",
    border: "hover:border-emerald-500/30"
  },
  past: {
    label: "Past Tense Group (Past)",
    text: "text-amber-500",
    badge: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    bg: "hover:bg-amber-500/5",
    border: "hover:border-amber-500/30"
  },
  future: {
    label: "Future Tense Group (Future)",
    text: "text-blue-400",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    bg: "hover:bg-blue-500/5",
    border: "hover:border-blue-500/30"
  },
};

export function TensesPage() {
  const { data, isLoading } = useQuery({ queryKey: ["tenses"], queryFn: api.tenses });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  const grouped = (data?.items ?? []).reduce<Record<string, NonNullable<typeof data>["items"]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in-50 duration-300">
      <PageHeader title="English Tenses" description="Your main focus area — 12 core tense types" />

      {["present", "past", "future"].map((cat) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        const style = categoryStyles[cat] ?? {
          label: cat,
          text: "text-primary",
          badge: "",
          bg: "hover:bg-accent/10",
          border: "hover:border-primary/50"
        };

        return (
          <section key={cat} className="space-y-4">
            <h2 className={cn("text-lg font-semibold tracking-tight", style.text)}>
              {style.label}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {items?.map((t) => {
                const total = t.attempts_count ?? 0;
                const correct = t.correct_count ?? 0;
                const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
                const targetCorrect = 10;
                const mastery = total > 0 ? Math.round(accuracy * Math.min(1, correct / targetCorrect)) : 0;

                return (
                  <Link key={t.id} to={`/tenses/${t.id}`} className="block h-full">
                    <Card className={cn(
                      "h-full flex flex-col justify-between transition-all",
                      style.bg,
                      style.border
                    )}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                          <CardTitle className="text-lg font-semibold text-foreground">{t.name_en}</CardTitle>
                          <Badge variant="outline" className={style.badge}>
                            {t.category.toUpperCase()}
                          </Badge>
                        </div>
                        <CardDescription className="text-sm">{t.name_tr}</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex items-center">
                          <code className="rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-mono text-primary font-medium tracking-wide">
                            {t.formula}
                          </code>
                        </div>

                        {/* Mastery Indicator */}
                        <div className="space-y-1.5 pt-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Mastery Level</span>
                            <span>{total > 0 ? `${mastery}% (${correct}/${total} correct)` : "Not started"}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-secondary/80 overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-300",
                                cat === "present" ? "bg-emerald-500" : cat === "past" ? "bg-amber-500" : "bg-blue-500"
                              )}
                              style={{ width: `${total > 0 ? Math.min(100, mastery) : 0}%` }}
                            />
                          </div>
                        </div>

                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
