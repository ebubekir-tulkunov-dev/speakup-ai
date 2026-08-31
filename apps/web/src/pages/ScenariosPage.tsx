import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function ScenariosPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["scenarios"], queryFn: api.scenarios });
  const { data: tensesData } = useQuery({ queryKey: ["tenses"], queryFn: api.tenses });

  const [selectedLevel, setSelectedLevel] = useState(() => {
    return localStorage.getItem("scenarios_level") || "B1";
  });
  const [topic, setTopic] = useState("");
  const [tenseFocus, setTenseFocus] = useState("mixed");

  const handleLevelChange = (lvl: string) => {
    setSelectedLevel(lvl);
    localStorage.setItem("scenarios_level", lvl);
  };

  const generateScenario = useMutation({
    mutationFn: () =>
      api.generateScenario({
        level: selectedLevel,
        topic: topic.trim() || "daily conversation",
        target_tense_slug: tenseFocus === "mixed" ? null : tenseFocus,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      // Redirect directly to the chat page to begin the newly generated scenario
      navigate(
        `/chat?scenario=${encodeURIComponent(res.title)}&tense=${tenseFocus === "mixed" ? "" : tenseFocus}&level=${selectedLevel}`
      );
    },
  });

  const getLevelBadgeClass = (lvl: string) => {
    const l = lvl.toUpperCase();
    if (l.startsWith("A")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (l.startsWith("B")) return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    if (l.startsWith("C")) return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  };

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in-50 duration-300">
      <PageHeader title="Scenarios" description="Practice conversation tailored to context and your level" />

      <div className="grid gap-8 md:grid-cols-3">
        {/* Left Column: Level Selector & AI Generator */}
        <div className="space-y-6 md:col-span-1">
          {/* Level Selector Card */}
          <Card className="border-border bg-card shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <Sparkles className="size-4 text-primary" /> Practice Level
              </CardTitle>
              <CardDescription className="text-xs">
                Set the English difficulty level for conversations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-1.5">
                {["A1", "A2", "B1", "B2", "C1", "C2"].map((lvl) => {
                  const active = selectedLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      onClick={() => handleLevelChange(lvl)}
                      className={cn(
                        "py-2 text-xs font-extrabold rounded-md border transition-all cursor-pointer",
                        active
                          ? "bg-primary border-primary text-primary-foreground shadow-sm"
                          : "bg-background hover:bg-accent/40 border-border text-foreground/80"
                      )}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* AI Generator Form Card */}
          <Card className="border-primary/25 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                <Wand2 className="size-4 text-primary animate-pulse" /> Generate Scenario with AI
              </CardTitle>
              <CardDescription className="text-xs">
                Design practice scenarios on any topic with AI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="topic" className="text-xs font-semibold">Scenario Topic</Label>
                <Input
                  id="topic"
                  placeholder="e.g. Hotel Check-in, Ordering Coffee..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="bg-background text-xs py-1.5 h-8 focus-visible:ring-primary/30"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Tense Focus</Label>
                <Select value={tenseFocus} onValueChange={setTenseFocus}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="mixed">Mixed / General</SelectItem>
                    {(tensesData?.items ?? []).map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.name_tr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => generateScenario.mutate()}
                disabled={generateScenario.isPending}
                className="w-full h-8 text-xs font-bold bg-primary hover:bg-primary/95 text-primary-foreground shadow-xs cursor-pointer"
              >
                {generateScenario.isPending ? "Generating scenario..." : "Create Scenario with AI"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Scenarios List */}
        <div className="space-y-4 md:col-span-2">
          <h3 className="font-semibold text-lg tracking-tight text-foreground">Available Scenarios</h3>
          <div className="grid gap-4">
            {(data?.items ?? []).map((s) => (
              <Link
                key={s.id}
                to={`/chat?scenario=${encodeURIComponent(s.title)}&tense=${s.target_tense_slug ?? ""}&level=${selectedLevel}`}
                className="block"
              >
                <Card className="transition-all hover:border-primary/50 hover:bg-accent/10 hover:shadow-2xs border-border bg-background/50">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle className="text-base font-semibold leading-snug">{s.title}</CardTitle>
                      <div className="flex gap-2 shrink-0">
                        <Badge variant="outline" className={getLevelBadgeClass(s.difficulty)}>
                          Recommended: {s.difficulty}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription className="text-sm mt-2 text-muted-foreground/90">{s.context}</CardDescription>
                    <p className="text-xs italic text-muted-foreground mt-3 pt-2.5 border-t border-border/10 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-primary/70 uppercase tracking-wider shrink-0">Opening Line:</span>
                      <span>"{s.opening_line}"</span>
                    </p>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
