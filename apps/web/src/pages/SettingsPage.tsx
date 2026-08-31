import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/Layout";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { NATIVE_LANGUAGES, nativeLanguageLabel } from "@/lib/languages";

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [goal, setGoal] = useState<number | null>(null);
  const [tts, setTts] = useState("cartesia");
  const [nativeLang, setNativeLang] = useState("tr");

  useEffect(() => {
    if (data?.settings?.tts_provider) {
      setTts(data.settings.tts_provider);
    }
    if (data?.native_lang) {
      setNativeLang(data.native_lang);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.updateSettings({
        daily_goal: goal ?? data?.daily_goal,
        tts_provider: tts,
        native_lang: nativeLang,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <PageHeader title="Settings" description="Manage your learning preferences" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Language Settings</CardTitle>
          <CardDescription>Native and target language</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Native Language</Label>
              <Select value={nativeLang} onValueChange={setNativeLang}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NATIVE_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground">Target Language</Label>
              <p className="mt-2 font-medium">{nativeLanguageLabel(data?.target_lang === "en" ? "en" : data?.target_lang)}</p>
            </div>
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="goal">Daily Word Goal</Label>
            <Input
              id="goal"
              type="number"
              defaultValue={data?.daily_goal}
              onChange={(e) => setGoal(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>TTS Provider (Live Voice)</Label>
            <Select value={tts} onValueChange={setTts}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cartesia">Cartesia (sonic-3.5)</SelectItem>
                <SelectItem value="minimax">Minimax (speech-2.6-turbo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
            Save
          </Button>
          {save.isSuccess && <p className="text-center text-sm text-emerald-400">Saved</p>}
        </CardContent>
      </Card>
    </div>
  );
}
