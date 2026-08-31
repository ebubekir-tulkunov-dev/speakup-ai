import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Volume2, CheckCircle2, XCircle, ArrowRight, BookOpen, Layers } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, VocabItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CEFR_LEVEL_OPTIONS } from "@/lib/cefr";
import { speechLocale } from "@/lib/languages";

const CEFR_LEVELS = CEFR_LEVEL_OPTIONS;

const WORD_TYPES = [
  { value: "ALL", label: "All" },
  { value: "adjective", label: "Adjectives" },
  { value: "verb", label: "Verbs" },
  { value: "phrasal_verb", label: "Phrasal Verbs" },
  { value: "adverb", label: "Adverbs" },
  { value: "noun", label: "Nouns" },
];

function toggleLevel(selected: string[], value: string): string[] {
  if (selected.includes(value)) {
    return selected.filter((l) => l !== value);
  }
  return [...selected, value];
}

type VocabDirection = "native_to_target" | "target_to_native";

const VOCAB_DIRECTION_KEY = "vocab-direction";

export function VocabPage() {
  const qc = useQueryClient();
  // Empty = all levels ("Hepsi"). Otherwise one or more CEFR levels.
  const [levels, setLevels] = useState<string[]>(["B1"]);
  const [wordType, setWordType] = useState("ALL");
  const [direction, setDirection] = useState<VocabDirection>(() => {
    const saved = localStorage.getItem(VOCAB_DIRECTION_KEY);
    return saved === "target_to_native" ? "target_to_native" : "native_to_target";
  });
  const [current, setCurrent] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [hasGuessed, setHasGuessed] = useState(false);
  const [isCorrectGuess, setIsCorrectGuess] = useState(false);
  const [phonetic, setPhonetic] = useState("");
  const [translatedExample, setTranslatedExample] = useState<string | null>(null);
  const [localQueue, setLocalQueue] = useState<VocabItem[]>([]);
  const sessionActiveRef = useRef(false);

  const allLevelsSelected = levels.length === 0;
  const levelsKey = allLevelsSelected ? "ALL" : [...levels].sort().join(",");
  const primaryLevel = allLevelsSelected ? "B1" : levels[0];

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const nativeLangKey = settings?.native_lang ?? "tr";
  const targetLangKey = settings?.target_lang ?? "en";
  const nativeLabel = nativeLangKey.toUpperCase();
  const targetLabel = targetLangKey.toUpperCase();

  const { data, isLoading } = useQuery({
    queryKey: ["vocab", levelsKey, wordType, nativeLangKey, direction],
    queryFn: () =>
      api.vocabQueue(
        10,
        allLevelsSelected ? undefined : levels,
        wordType === "ALL" ? undefined : wordType,
        direction,
      ),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // When filters change, start a fresh session
  useEffect(() => {
    sessionActiveRef.current = false;
    setLocalQueue([]);
    setCurrent(0);
    setSelectedOption(null);
    setHasGuessed(false);
    setIsCorrectGuess(false);
    setTranslatedExample(null);
  }, [levelsKey, wordType, nativeLangKey, direction]);

  const setDirectionAndPersist = (next: VocabDirection) => {
    setDirection(next);
    localStorage.setItem(VOCAB_DIRECTION_KEY, next);
  };

  // Fill the queue once per session — do NOT reset on background refetch
  useEffect(() => {
    if (!data?.items?.length) return;
    if (sessionActiveRef.current) return;
    setLocalQueue([...data.items]);
    setCurrent(0);
    sessionActiveRef.current = true;
  }, [data?.items]);

  const card: VocabItem | undefined = localQueue[current];

  // Reset guessing states when moving to another card
  useEffect(() => {
    setSelectedOption(null);
    setHasGuessed(false);
    setIsCorrectGuess(false);
    setTranslatedExample(null);
  }, [current, card?.word_id]);

  // Fetch example translation dynamically when guessed
  useEffect(() => {
    if (hasGuessed && card && card.example) {
      if (card.example_tr) {
        setTranslatedExample(card.example_tr);
      } else {
        api.translateVocabExample(card.word_id)
          .then((res) => {
            if (res.example_tr) {
              setTranslatedExample(res.example_tr);
            }
          })
          .catch((err) => {
            console.error("Failed to translate example sentence:", err);
          });
      }
    }
  }, [hasGuessed, card?.word_id, card?.example_tr, card?.example]);

  const review = useMutation({
    mutationFn: ({
      wordId,
      quality,
      isCorrect,
      userAns,
      cardType,
    }: {
      wordId: string;
      quality: string;
      isCorrect?: boolean;
      userAns?: string;
      cardType?: string;
    }) =>
      api.vocabReview(wordId, quality, {
        is_correct: isCorrect,
        user_answer: userAns,
        card_type: cardType,
      }),
    onSuccess: () => {
      setSelectedOption(null);
      setHasGuessed(false);
      setIsCorrectGuess(false);
      setCurrent((c) => {
        const next = c + 1;
        if (next >= localQueue.length) {
          // Allow the next fetch to refill the queue
          sessionActiveRef.current = false;
          setLocalQueue([]);
          qc.invalidateQueries({ queryKey: ["vocab"] });
        }
        return next;
      });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const handleReview = (quality: string) => {
    if (!card) return;
    const isWrong = quality === "again" || !isCorrectGuess;

    if (isWrong) {
      // Append a duplicate of the card to repeat it at the end of the session
      setLocalQueue((prev) => [...prev, { ...card }]);
    }

    review.mutate({
      wordId: card.word_id,
      quality,
      isCorrect: isCorrectGuess,
      userAns: selectedOption || undefined,
      cardType: card.card_type,
    });
  };

  const generate = useMutation({
    mutationFn: (typeToGen?: string) => {
      const activeType = typeToGen || (wordType === "ALL" ? undefined : wordType);
      let topicStr = "English vocabulary, phrasal verbs, and expressions";
      if (activeType === "adjective") topicStr = "Useful adjectives for daily conversation, descriptive words, feelings, size, quality";
      if (activeType === "verb") topicStr = "Action verbs, irregular verbs, communication verbs, mental state verbs";
      if (activeType === "phrasal_verb") topicStr = "Common phrasal verbs used in everyday life, business, and social contexts";
      if (activeType === "adverb") topicStr = "Adverbs of frequency, manner, degree, and time";
      if (activeType === "noun") topicStr = "Objects, concepts, people, abstract nouns";

      return api.generateVocab({
        level: primaryLevel,
        topic: topicStr,
        count: 30, // Generate more in bulk
        word_type: activeType,
      });
    },
    onSuccess: () => {
      sessionActiveRef.current = false;
      setLocalQueue([]);
      setCurrent(0);
      qc.invalidateQueries({ queryKey: ["vocab"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  // Fetch phonetic spelling when the card changes
  useEffect(() => {
    if (!card?.lemma) return;
    setPhonetic("");
    const lookupWord = card.lemma.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "");
    if (!lookupWord) return;

    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${lookupWord}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data[0]) {
          const entry = data[0];
          if (entry.phonetic) {
            setPhonetic(entry.phonetic);
          } else if (entry.phonetics && entry.phonetics.length > 0) {
            const p = entry.phonetics.find((x: any) => x.text);
            if (p) setPhonetic(p.text);
          }
        }
      })
      .catch(() => {});
  }, [card?.lemma]);

  const speak = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!card) return;
    const speakTarget = isNativeToTarget && !hasGuessed;
    const text = speakTarget ? nativeGloss : card.lemma;
    if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speakTarget
      ? speechLocale(card.native_lang ?? "tr")
      : speechLocale(card.target_lang ?? "en");
    window.speechSynthesis.speak(utterance);
  };

  const isNativeToTarget =
    card?.card_type === "native_to_target" ||
    card?.card_type === "tr_to_en" ||
    (card?.card_type !== "target_to_native" &&
      card?.card_type !== "en_to_tr" &&
      direction === "native_to_target");
  const nativeGloss = card?.native_translation ?? card?.translation_tr;
  const prompt = isNativeToTarget ? nativeGloss : card?.lemma;
  const correctAnswer = isNativeToTarget ? card?.lemma : nativeGloss;

  const handleSelectOption = (option: string) => {
    if (hasGuessed) return;
    setSelectedOption(option);
    setHasGuessed(true);
    const correct = option.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
    setIsCorrectGuess(correct);
    speak();
  };

  const handlePass = () => {
    if (hasGuessed) return;
    setSelectedOption(null);
    setHasGuessed(true);
    setIsCorrectGuess(false);
    speak();
  };

  const getWordTypeLabel = (wt?: string) => {
    switch (wt) {
      case "adjective": return "Adjective";
      case "verb": return "Verb";
      case "phrasal_verb": return "Phrasal Verb";
      case "adverb": return "Adverb";
      case "noun": return "Noun";
      default: return wt || "Word";
    }
  };

  if (isLoading) return <p className="text-muted-foreground p-6 text-center">Loading...</p>;

  if (!card) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in duration-300">
        <PageHeader 
          title="Vocabulary Flashcards"
          description="Build your English vocabulary by category"
          action={
            <Link to="/vocab/practice">
              <Button size="sm" className="gap-2">
                <Sparkles className="size-3.5" />
                Sentence Practice
              </Button>
            </Link>
          }
        />
        
        {/* Level Selector — multi-select */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block text-center">Speaking Level (multi-select)</label>
          <div className="flex flex-wrap justify-center gap-1.5 p-1 bg-secondary/35 rounded-xl border border-border/40 w-fit mx-auto">
            <button
              onClick={() => setLevels([])}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
                allLevelsSelected
                  ? "bg-primary text-primary-foreground shadow-sm scale-102"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              )}
            >
              All
            </button>
            {CEFR_LEVELS.map((lvl) => (
              <button
                key={lvl.value}
                onClick={() => setLevels((prev) => toggleLevel(prev, lvl.value))}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
                  !allLevelsSelected && levels.includes(lvl.value)
                    ? "bg-primary text-primary-foreground shadow-sm scale-102"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                )}
              >
                {lvl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Word Type Tabs */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block text-center">Word Type</label>
          <div className="flex flex-wrap justify-center gap-1.5 p-1 bg-secondary/35 rounded-xl border border-border/40 w-fit mx-auto">
            {WORD_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setWordType(t.value)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-300 cursor-pointer",
                  wordType === t.value
                    ? "bg-primary text-primary-foreground shadow-sm scale-102"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block text-center">Card Direction</label>
          <div className="flex justify-center gap-1.5 p-1 bg-secondary/35 rounded-xl border border-border/40 w-fit mx-auto">
            <button
              type="button"
              onClick={() => setDirectionAndPersist("native_to_target")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
                direction === "native_to_target"
                  ? "bg-primary text-primary-foreground shadow-sm scale-102"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
              )}
            >
              {nativeLabel} → {targetLabel}
            </button>
            <button
              type="button"
              onClick={() => setDirectionAndPersist("target_to_native")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
                direction === "target_to_native"
                  ? "bg-primary text-primary-foreground shadow-sm scale-102"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
              )}
            >
              {targetLabel} → {nativeLabel}
            </button>
          </div>
        </div>

        <Card className="bg-card/75 border-border/60 shadow-lg">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <p className="text-center text-muted-foreground text-sm leading-relaxed px-4">
              No words found for this level ({allLevelsSelected ? "All" : levels.join(", ")}) and type ({getWordTypeLabel(wordType)}). Generate new targeted words with AI to expand your vocabulary.
            </p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl pt-4">
              <Button onClick={() => generate.mutate("adjective")} disabled={generate.isPending} className="w-full flex gap-2">
                <Sparkles className="size-4" />
                Generate 30 Adjectives
              </Button>
              <Button onClick={() => generate.mutate("verb")} disabled={generate.isPending} className="w-full flex gap-2">
                <Sparkles className="size-4" />
                Generate 30 Verbs
              </Button>
              <Button onClick={() => generate.mutate("phrasal_verb")} disabled={generate.isPending} className="w-full flex gap-2">
                <Sparkles className="size-4" />
                Generate 30 Phrasal Verbs
              </Button>
              <Button onClick={() => generate.mutate(wordType === "ALL" ? undefined : wordType)} disabled={generate.isPending} className="w-full flex gap-2 variant-outline">
                <Layers className="size-4" />
                Generate from Selected Type
              </Button>
            </div>
            {generate.isSuccess && (
              <p className="text-sm text-emerald-500 font-medium animate-bounce mt-2">
                ✅ {generate.data?.added} new words added successfully!
              </p>
            )}
            {generate.isError && (
              <p className="text-sm text-destructive font-medium mt-2 text-center">
                Generation failed. Check that the AI service is running, then try again.
              </p>
            )}
            {generate.isPending && (
              <p className="text-sm text-muted-foreground font-medium mt-2 text-center animate-pulse">
                AI is generating words (this may take a few seconds)...
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const options = card.options ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Vocabulary Flashcards"
        description="Smart flashcards optimized for your learning frequency"
        action={
          <div className="flex items-center gap-3">
            <Link to="/vocab/practice">
              <Button size="sm" className="gap-2 shrink-0">
                <Sparkles className="size-3.5" />
                Sentence Practice
              </Button>
            </Link>
            <Badge variant="secondary" className="px-2.5 py-1 text-xs">
              {current + 1} / {localQueue.length}
            </Badge>
          </div>
        }
      />

      {/* Level Selector — multi-select */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap justify-center gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit mx-auto">
          <button
            onClick={() => setLevels([])}
            className={cn(
              "px-3 py-1 rounded-lg text-[11px] font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
              allLevelsSelected
                ? "bg-primary text-primary-foreground shadow-sm scale-102"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
            )}
          >
            All
          </button>
          {CEFR_LEVELS.map((lvl) => (
            <button
              key={lvl.value}
              onClick={() => setLevels((prev) => toggleLevel(prev, lvl.value))}
              className={cn(
                "px-3 py-1 rounded-lg text-[11px] font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
                !allLevelsSelected && levels.includes(lvl.value)
                  ? "bg-primary text-primary-foreground shadow-sm scale-102"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              )}
            >
              {lvl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Direction: native → target or target → native */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block text-center">
          Card Direction
        </label>
        <div className="flex justify-center gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit mx-auto">
          <button
            type="button"
            onClick={() => setDirectionAndPersist("native_to_target")}
            className={cn(
              "px-3 py-1 rounded-lg text-[11px] font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
              direction === "native_to_target"
                ? "bg-primary text-primary-foreground shadow-sm scale-102"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
            )}
          >
            {nativeLabel} → {targetLabel}
          </button>
          <button
            type="button"
            onClick={() => setDirectionAndPersist("target_to_native")}
            className={cn(
              "px-3 py-1 rounded-lg text-[11px] font-semibold tracking-wide uppercase transition-all duration-300 cursor-pointer",
              direction === "target_to_native"
                ? "bg-primary text-primary-foreground shadow-sm scale-102"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
            )}
          >
            {targetLabel} → {nativeLabel}
          </button>
        </div>
      </div>

      {/* Word Type Selector */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap justify-center gap-1.5 p-1 bg-secondary/30 rounded-xl border border-border/40 w-fit mx-auto">
          {WORD_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setWordType(t.value)}
              className={cn(
                "px-3 py-1 rounded-lg text-[11px] font-semibold tracking-wide transition-all duration-300 cursor-pointer",
                wordType === t.value
                  ? "bg-primary text-primary-foreground shadow-sm scale-102"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Progress Dots */}
      <div className="flex justify-center gap-1.5 py-1">
        {localQueue.slice(0, 15).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === current
                ? "bg-primary w-6 shadow-xs shadow-primary/20"
                : i < current
                ? "bg-primary/50 w-2.5"
                : "bg-muted border border-border/50 w-1.5"
            )}
          />
        ))}
      </div>

      {/* The Guessing Card */}
      <Card className="bg-card border border-border shadow-lg hover:border-primary/10 transition-all duration-300 rounded-2xl p-6 space-y-6">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase border-primary/20 text-primary">
              {isNativeToTarget ? `${nativeLabel} → ${targetLabel}` : `${targetLabel} → ${nativeLabel}`}
            </Badge>
            {card.level && (
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px] font-bold bg-secondary/60">
                {card.level}
              </Badge>
            )}
            {card.word_type && (
              <Badge variant="outline" className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 border-blue-200 bg-blue-50/50">
                {getWordTypeLabel(card.word_type)}
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="size-8 rounded-full bg-secondary/20 hover:bg-primary/10 text-primary transition-colors cursor-pointer" onClick={() => speak()} title={isNativeToTarget && !hasGuessed ? "Listen (native)" : "Listen (English)"}>
            <Volume2 className="size-4" />
          </Button>
        </div>

        <div className="text-center space-y-2 py-2">
          <h2 className="text-4xl font-bold tracking-tight text-foreground">{prompt}</h2>
          {isNativeToTarget && phonetic && hasGuessed && (
            <p className="text-sm font-mono text-muted-foreground/75 tracking-wider">{phonetic}</p>
          )}
          {!isNativeToTarget && phonetic && (
            <p className="text-sm font-mono text-muted-foreground/75 tracking-wider">{phonetic}</p>
          )}
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {options.map((option, idx) => {
            const isCorrect = option.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
            const isSelected = selectedOption === option;

            return (
              <button
                key={idx}
                disabled={hasGuessed}
                onClick={() => handleSelectOption(option)}
                className={cn(
                  "w-full text-left px-4 py-3.5 rounded-xl border transition-all duration-200 text-sm font-medium flex items-center justify-between gap-2 shadow-2xs cursor-pointer",
                  !hasGuessed && "bg-secondary/25 border-border/60 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground text-muted-foreground",
                  hasGuessed && isCorrect && "bg-emerald-500/10 border-emerald-500/60 text-emerald-600 font-semibold scale-101 shadow-sm",
                  hasGuessed && isSelected && !isCorrect && "bg-destructive/10 border-destructive/50 text-destructive font-semibold",
                  hasGuessed && !isCorrect && !isSelected && "opacity-40 border-border/40 text-muted-foreground"
                )}
              >
                <span className="truncate">{option}</span>
                {hasGuessed && isCorrect && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
                {hasGuessed && isSelected && !isCorrect && <XCircle className="size-4 shrink-0 text-destructive" />}
              </button>
            );
          })}
        </div>

        {/* Skip / I Don't Know button */}
        {!hasGuessed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePass}
            className="w-full text-muted-foreground hover:text-foreground text-xs tracking-wide uppercase font-semibold border border-transparent hover:border-border/30 rounded-xl cursor-pointer"
          >
            I don't know / Skip
          </Button>
        )}

        {/* Revealed details section */}
        {hasGuessed && (
          <div className="space-y-4 pt-4 border-t border-border/40 animate-in fade-in-50 slide-in-from-top-3 duration-300">
            {!isNativeToTarget && (
              <div className="text-center space-y-1 py-1">
                <p className="text-lg font-bold text-emerald-600">"{card.lemma}"</p>
                <p className="text-xs text-muted-foreground italic">{card.translation_tr}</p>
              </div>
            )}

            {/* Verb forms or comparative adjective info */}
            {card.forms && Object.keys(card.forms).length > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs space-y-1.5">
                <p className="font-bold text-muted-foreground text-[10px] uppercase tracking-wider flex items-center gap-1">
                  <Layers className="size-3.5" /> Other Forms
                </p>
                <div className="grid grid-cols-2 gap-2 text-foreground font-medium">
                  {Object.entries(card.forms).map(([key, val]) => (
                    <div key={key} className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground capitalize">{key.replace("_", " ")}:</span>
                      <span className="text-primary">{val as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Synonyms & Antonyms */}
            {((card.synonyms && card.synonyms.length > 0) || (card.antonyms && card.antonyms.length > 0)) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {card.synonyms && card.synonyms.length > 0 && (
                  <div className="rounded-xl border border-border/50 bg-secondary/10 p-3 space-y-1">
                    <p className="font-bold text-emerald-600 text-[10px] uppercase tracking-wider">Synonyms</p>
                    <p className="font-medium text-foreground">{card.synonyms.join(", ")}</p>
                  </div>
                )}
                {card.antonyms && card.antonyms.length > 0 && (
                  <div className="rounded-xl border border-border/50 bg-secondary/10 p-3 space-y-1">
                    <p className="font-bold text-red-500/80 text-[10px] uppercase tracking-wider">Antonyms</p>
                    <p className="font-medium text-foreground">{card.antonyms.join(", ")}</p>
                  </div>
                )}
              </div>
            )}

            {/* Common Collocations */}
            {card.collocations && card.collocations.length > 0 && (
              <div className="rounded-xl border border-border bg-secondary/20 p-3 text-xs space-y-1">
                <p className="font-bold text-blue-600 text-[10px] uppercase tracking-wider flex items-center gap-1">
                  <BookOpen className="size-3.5" /> Common Collocations
                </p>
                <ul className="list-disc pl-4 text-foreground/90 font-medium space-y-0.5">
                  {card.collocations.map((col, idx) => (
                    <li key={idx}>{col}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Example sentence block */}
            {card.example && (
              <div className="bg-secondary/35 border border-border/30 rounded-xl p-4 space-y-1.5 shadow-2xs text-left">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Usage in a Sentence</p>
                <p className="text-sm font-medium leading-relaxed italic text-foreground">"{card.example}"</p>
                {translatedExample && (
                  <p className="text-xs text-muted-foreground font-medium leading-relaxed pt-2 border-t border-border/20 mt-2 animate-in fade-in duration-300">
                    {translatedExample}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2.5">
              {/* Devam Et Button */}
              <Button
                className="w-full py-5 text-sm font-semibold tracking-wide bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm rounded-xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
                disabled={review.isPending}
                onClick={() => handleReview(isCorrectGuess ? "good" : "again")}
              >
                <span>Continue</span>
                <ArrowRight className="size-4 animate-pulse" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Bulk Generator under the active card too to make it easily accessible */}
      <Card className="border border-border/50 bg-secondary/15">
        <CardContent className="py-4 space-y-3">
          <p className="text-xs text-muted-foreground font-semibold text-center uppercase tracking-wider">Bulk Vocabulary Expansion</p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" className="text-[10px] h-8 hover:bg-primary hover:text-white" onClick={() => generate.mutate("adjective")} disabled={generate.isPending}>
              +30 Adjectives
            </Button>
            <Button variant="outline" size="sm" className="text-[10px] h-8 hover:bg-primary hover:text-white" onClick={() => generate.mutate("verb")} disabled={generate.isPending}>
              +30 Verbs
            </Button>
            <Button variant="outline" size="sm" className="text-[10px] h-8 hover:bg-primary hover:text-white" onClick={() => generate.mutate("phrasal_verb")} disabled={generate.isPending}>
              +30 Phrasal
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
