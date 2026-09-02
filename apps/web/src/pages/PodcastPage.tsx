import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Headphones,
  Loader2,
  Trash2,
  Video,
  Clock,
  Users,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PodcastUtterance } from "@/lib/api";

const SPEAKER_COLORS = [
  "border-l-sky-500 bg-sky-500/5",
  "border-l-emerald-500 bg-emerald-500/5",
  "border-l-amber-500 bg-amber-500/5",
  "border-l-rose-500 bg-rose-500/5",
  "border-l-violet-500 bg-violet-500/5",
  "border-l-cyan-500 bg-cyan-500/5",
];

const SPEAKER_BADGE = [
  "bg-sky-500/15 text-sky-400 border-sky-500/25",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  "bg-amber-500/15 text-amber-400 border-amber-500/25",
  "bg-rose-500/15 text-rose-400 border-rose-500/25",
  "bg-violet-500/15 text-violet-400 border-violet-500/25",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
];

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function formatDuration(sec?: number | null): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "downloading":
      return "Downloading audio…";
    case "transcribing":
      return "Transcribing (Deepgram)…";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function PodcastPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["podcast-episodes"],
    queryFn: api.podcastEpisodes,
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      const busy = items.some((e) =>
        ["pending", "downloading", "transcribing"].includes(e.status),
      );
      return busy ? 2500 : false;
    },
  });

  const importEp = useMutation({
    mutationFn: () => api.importPodcast(url.trim()),
    onSuccess: (ep) => {
      qc.invalidateQueries({ queryKey: ["podcast-episodes"] });
      setUrl("");
      navigate(`/podcast/${ep.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePodcast(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["podcast-episodes"] }),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in-50 duration-300">
      <PageHeader
        title="YouTube Podcasts"
        description="Paste a YouTube podcast URL — we extract audio and transcribe with speaker labels via Deepgram"
      />

      <Card className="border-primary/30 shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Import from YouTube</CardTitle>
            <Badge className="bg-primary/20 text-primary border-primary/30">Deepgram</Badge>
          </div>
          <CardDescription>
            Audio is downloaded, then diarized so Speaker 1 / 2 / 3 stay separated in the transcript.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>YouTube URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="bg-card"
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !importEp.isPending) importEp.mutate();
              }}
            />
          </div>
          <Button
            className="w-full gap-2"
            disabled={!url.trim() || importEp.isPending}
            onClick={() => importEp.mutate()}
          >
            {importEp.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Video className="size-4" />
            )}
            {importEp.isPending ? "Starting…" : "Download & Transcribe"}
          </Button>
          {importEp.isError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="size-3.5" />
              {importEp.error instanceof Error ? importEp.error.message : "Import failed"}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h3 className="font-semibold text-lg tracking-tight flex items-center gap-2">
          <Headphones className="size-5 text-primary" /> Your podcasts
        </h3>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (data?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No episodes yet. Paste a URL above.</p>
        ) : (
          <div className="grid gap-3">
            {(data?.items ?? []).map((ep) => (
              <Card key={ep.id} className="transition-all hover:border-primary/40 shadow-xs">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/podcast/${ep.id}`} className="min-w-0 flex-1 space-y-1">
                      <CardTitle className="text-base font-semibold leading-snug hover:text-primary transition-colors">
                        {ep.title || "Untitled"}
                      </CardTitle>
                      {ep.channel && (
                        <CardDescription className="text-xs">{ep.channel}</CardDescription>
                      )}
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          ep.status === "ready" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                          ep.status === "failed" && "bg-destructive/10 text-destructive border-destructive/20",
                          ["pending", "downloading", "transcribing"].includes(ep.status) &&
                            "bg-amber-500/10 text-amber-400 border-amber-500/20",
                        )}
                      >
                        {["pending", "downloading", "transcribing"].includes(ep.status) && (
                          <Loader2 className="size-3 animate-spin mr-1" />
                        )}
                        {statusLabel(ep.status)}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(ep.id)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-2">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" /> {formatDuration(ep.duration_sec)}
                    </span>
                    {ep.speaker_count > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" /> {ep.speaker_count} speakers
                      </span>
                    )}
                  </div>
                  {ep.error && <p className="text-xs text-destructive mt-2">{ep.error}</p>}
                  {ep.preview && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{ep.preview}</p>
                  )}
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PodcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [filterSpeaker, setFilterSpeaker] = useState<number | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["podcast-episode", id],
    queryFn: () => api.podcastEpisode(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      return st && ["pending", "downloading", "transcribing"].includes(st) ? 2000 : false;
    },
  });

  useEffect(() => {
    if (data?.status === "ready") {
      qc.invalidateQueries({ queryKey: ["podcast-episodes"] });
    }
  }, [data?.status, qc]);

  const speakers = useMemo(() => {
    if (!data?.utterances) return [];
    return [...new Set(data.utterances.map((u) => u.speaker))].sort((a, b) => a - b);
  }, [data?.utterances]);

  const visible: PodcastUtterance[] = useMemo(() => {
    if (!data?.utterances) return [];
    if (filterSpeaker === "all") return data.utterances;
    return data.utterances.filter((u) => u.speaker === filterSpeaker);
  }, [data?.utterances, filterSpeaker]);

  if (isLoading || !data) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  const busy = ["pending", "downloading", "transcribing"].includes(data.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in-50 duration-300">
      <div className="flex items-center gap-2">
        <Link to="/podcast">
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" /> Back
          </Button>
        </Link>
      </div>

      <PageHeader
        title={data.title || "Podcast"}
        description={data.channel ?? undefined}
        action={
          <Badge
            variant="outline"
            className={cn(
              data.status === "ready" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
              data.status === "failed" && "bg-destructive/10 text-destructive border-destructive/20",
              busy && "bg-amber-500/10 text-amber-400 border-amber-500/20",
            )}
          >
            {busy && <Loader2 className="size-3 animate-spin mr-1" />}
            {statusLabel(data.status)}
          </Badge>
        }
      />

      <Card className="bg-secondary/20 border-border/60">
        <CardContent className="py-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4 text-primary" /> {formatDuration(data.duration_sec)}
          </span>
          {data.speaker_count > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4 text-primary" /> {data.speaker_count} speakers
            </span>
          )}
          {data.youtube_url && (
            <a
              href={data.youtube_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              <ExternalLink className="size-4" /> Open on YouTube
            </a>
          )}
        </CardContent>
      </Card>

      {busy && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="font-medium">{statusLabel(data.status)}</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              Long podcasts can take several minutes. This page refreshes automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {data.status === "failed" && (
        <Card className="border-destructive/40">
          <CardContent className="py-6 flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">Transcription failed</p>
              <p className="text-sm text-muted-foreground mt-1">{data.error || "Unknown error"}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {data.status === "ready" && (
        <>
          {speakers.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={filterSpeaker === "all" ? "default" : "outline"}
                onClick={() => setFilterSpeaker("all")}
              >
                All speakers
              </Button>
              {speakers.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={filterSpeaker === s ? "default" : "outline"}
                  onClick={() => setFilterSpeaker(s)}
                >
                  Speaker {s}
                </Button>
              ))}
            </div>
          )}

          <Card className="shadow-md">
            <CardContent className="p-0 divide-y divide-border/40">
              {visible.map((u, i) => {
                const colorIdx = (u.speaker - 1) % SPEAKER_COLORS.length;
                return (
                  <div
                    key={`${u.start}-${i}`}
                    className={cn("border-l-4 px-4 py-3 space-y-1.5", SPEAKER_COLORS[colorIdx])}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn("text-[10px]", SPEAKER_BADGE[colorIdx])}>
                        Speaker {u.speaker}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatTime(u.start)}
                        {u.end ? ` – ${formatTime(u.end)}` : ""}
                      </span>
                    </div>
                    <p className="text-[15px] leading-relaxed text-foreground">{u.text}</p>
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">No utterances.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
