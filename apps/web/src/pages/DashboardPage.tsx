import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, Languages, Bot, Database, Flame, BarChart3, CheckSquare, Speech } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  const stats = data?.stats;
  const accuracy = stats?.accuracy ?? 0;
  const streak = stats?.streak ?? 0;
  const vocabLearned = stats?.vocab_learned ?? 0;
  const wordsTotal = stats?.words_total ?? 0;
  const tensesLearned = stats?.tenses_learned ?? 0;
  const tensesTotal = stats?.tenses_total ?? 0;
  const dailyGoal = stats?.daily_goal ?? 20;
  const completedToday = stats?.completed_today ?? 0;
  const progressPercent = Math.min(100, Math.round((completedToday / dailyGoal) * 100));

  const quickLinks = [
  // Journal, Tenses ve Top Words geçici kapatıldı — bkz. lib/disabledFeatures.ts
    { to: "/vocab", icon: BookOpen, title: "Vocabulary Review", desc: `${data?.vocab_due ?? 0} cards due`, color: "text-primary bg-primary/10" },
    { to: "/speak", icon: Speech, title: "Speak & Translate", desc: "Read Turkish, speak English", color: "text-violet-500 bg-violet-500/10" },
    { to: "/chat", icon: Bot, title: "AI Chat", desc: "Scenario or free practice", color: "text-emerald-500 bg-emerald-500/10" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in-50 duration-300">
      
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-2">
        <PageHeader 
          title="Dashboard" 
          description="Your learning journey, daily goals, and statistics" 
        />
        
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 px-4 py-2.5 rounded-full w-fit">
          <Flame className="size-5 text-amber-500 fill-amber-500 animate-bounce" />
          <div>
            <div className="text-xs text-amber-500/70 font-semibold tracking-wide uppercase">Daily Streak</div>
            <div className="text-sm font-bold text-amber-400">{streak} Day Streak</div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { 
            label: "Daily Streak", 
            value: `${streak} Days`, 
            desc: "Consecutive practice days", 
            icon: Flame, 
            color: "text-amber-500" 
          },
          { 
            label: "Words Learned", 
            value: vocabLearned, 
            desc: `Out of ${wordsTotal} total words`, 
            icon: BookOpen, 
            color: "text-blue-400" 
          },
          { 
            label: "Tenses Studied", 
            value: `${tensesLearned} / ${tensesTotal}`, 
            desc: "12 English tense types", 
            icon: Languages, 
            color: "text-emerald-400" 
          },
          { 
            label: "Overall Accuracy", 
            value: `${accuracy}%`, 
            desc: `From ${stats?.attempts_total ?? 0} total answers`, 
            icon: BarChart3, 
            color: "text-primary" 
          },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="relative overflow-hidden group">
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div className="space-y-1">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</CardDescription>
                  <CardTitle className="text-3xl font-extrabold tracking-tight">{s.value ?? "0"}</CardTitle>
                </div>
                <div className={`p-2 rounded-lg bg-secondary/80 ${s.color}`}>
                  <Icon className="size-5" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-primary/20 shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="size-5 text-primary" />
              <CardTitle className="text-base font-bold">Daily Goal Progress</CardTitle>
            </div>
            <Badge className="bg-primary/20 text-primary border-primary/30 font-semibold text-xs">
              {progressPercent}% Complete
            </Badge>
          </div>
          <CardDescription className="text-sm">
            Today you completed <span className="text-foreground font-semibold">{completedToday}</span> words/activities. Goal: <span className="text-foreground font-semibold">{dailyGoal}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2 pb-6">
          <Progress value={progressPercent} className="h-2.5 bg-secondary" />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="font-semibold text-lg tracking-tight">Quick Access</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {quickLinks.map((item) => (
            <Link key={item.to} to={item.to} className="block">
              <Card className="h-full transition-all hover:border-primary/40 hover:bg-secondary/40 shadow-xs">
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className={`flex size-11 items-center justify-center rounded-lg ${item.color} shrink-0`}>
                    <item.icon className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">{item.title}</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground mt-0.5">{item.desc}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <Card className="bg-secondary/20 border-border/40">
        <CardContent className="flex items-center justify-between py-4 text-sm">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Database Connection (MongoDB)</span>
          </div>
          <Badge variant={health?.mongodb ? "success" : "destructive"} className="px-2.5">
            {health?.mongodb ? "Connected" : "Disconnected"}
          </Badge>
        </CardContent>
      </Card>

    </div>
  );
}
