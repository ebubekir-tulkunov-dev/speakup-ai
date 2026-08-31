import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, Clock, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ReaderPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["passages"], queryFn: api.passages });
  const [level, setLevel] = useState("B1");
  const [topic, setTopic] = useState("work and career");
  const [tenseFocus, setTenseFocus] = useState("mixed tenses");

  const generate = useMutation({
    mutationFn: () =>
      api.generateReading({ level, topic, tense_focus: tenseFocus, word_count: 130 }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["passages"] });
      navigate(`/reader/${res.id}`);
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
    <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Text Reader"
        description="Generate long-form texts with AI — hover over words for instant translation"
      />

      <Card className="border-primary/30 shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Generate AI Text</CardTitle>
            <Badge className="bg-primary/20 text-primary border-primary/30">AI</Badge>
          </div>
          <CardDescription>Create a reading passage with a specific tense focus</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="bg-card border-border focus:ring-primary/40 focus:border-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="A1">A1</SelectItem>
                  <SelectItem value="A2">A2</SelectItem>
                  <SelectItem value="B1">B1</SelectItem>
                  <SelectItem value="B2">B2</SelectItem>
                  <SelectItem value="C1">C1</SelectItem>
                  <SelectItem value="C2">C2</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Tense Focus</Label>
              <Select value={tenseFocus} onValueChange={setTenseFocus}>
                <SelectTrigger className="bg-card border-border focus:ring-primary/40 focus:border-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="mixed tenses">All / Mixed</SelectItem>
                  <SelectItem value="present simple">Present Simple</SelectItem>
                  <SelectItem value="present perfect">Present Perfect</SelectItem>
                  <SelectItem value="past simple">Past Simple</SelectItem>
                  <SelectItem value="past continuous">Past Continuous</SelectItem>
                  <SelectItem value="future tenses">Future Tenses</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Topic</Label>
            <Input 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
              placeholder="e.g. travel, technology, health" 
              className="bg-card border-border focus-visible:ring-primary/40 focus-visible:border-primary/50"
            />
          </div>
          <Button className="w-full bg-primary hover:bg-primary/95 text-primary-foreground font-semibold shadow-xs" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Sparkles className="size-4" />
            {generate.isPending ? "Generating text..." : "Create AI Text"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg tracking-tight text-foreground flex items-center gap-2">
          <BookOpen className="size-5 text-primary" /> Existing Passages
        </h3>
        <div className="grid gap-4">
          {(data?.items ?? []).map((p) => (
            <Link key={p.id} to={`/reader/${p.id}`} className="block">
              <Card className="transition-all hover:border-primary/40 hover:bg-secondary/40 shadow-xs">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <CardTitle className="text-base font-semibold text-foreground leading-snug">{p.title}</CardTitle>
                    <div className="flex gap-2 shrink-0">
                      {p.source === "ai" && <Badge className="bg-primary/10 text-primary border-primary/20">AI</Badge>}
                      <Badge variant="outline" className={getLevelBadgeClass(p.level)}>
                        {p.level.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                  {p.tense_focus && (
                    <CardDescription className="text-xs text-primary font-medium tracking-wide uppercase mt-1">
                      Tense: {p.tense_focus === "mixed tenses" ? "All / Mixed" : p.tense_focus}
                    </CardDescription>
                  )}
                  <CardDescription className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {p.preview}
                  </CardDescription>
                  
                  {/* Reading Time Badge */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-4 pt-2 border-t border-border/20">
                    <Clock className="size-3.5" />
                    <span>⏱ {Math.ceil(p.word_count / 150)} min read</span>
                    <span className="text-border/50">•</span>
                    <span>{p.word_count} words</span>
                  </div>

                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
