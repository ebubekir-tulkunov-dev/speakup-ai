import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, CheckCircle2, XCircle, BookOpen, ArrowLeft, Send, Search, HelpCircle, Lightbulb, Shuffle } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { api, SentenceEvaluation } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface LearnedWordItem {
  word_id: string;
  lemma: string;
  translation_tr: string;
  word_type: string;
  level: string;
  example: string | null;
}

export function SentencePracticePage() {
  const [selectedWord, setSelectedWord] = useState<LearnedWordItem | null>(null);
  const [sentence, setSentence] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [result, setResult] = useState<SentenceEvaluation | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["learned-vocab"],
    queryFn: api.learnedVocab,
  });

  const words: LearnedWordItem[] = data?.items ?? [];

  // Automatically select a random word when data loads and nothing is selected
  useEffect(() => {
    if (words.length > 0 && !selectedWord) {
      const randomIdx = Math.floor(Math.random() * words.length);
      setSelectedWord(words[randomIdx]);
    }
  }, [words, selectedWord]);

  const handleRandomSelect = () => {
    if (words.length === 0) return;
    let nextWord = selectedWord;
    if (words.length > 1) {
      while (nextWord?.word_id === selectedWord?.word_id) {
        const randomIdx = Math.floor(Math.random() * words.length);
        nextWord = words[randomIdx];
      }
    } else {
      nextWord = words[0];
    }
    if (nextWord) {
      handleWordSelect(nextWord);
    }
  };

  const check = useMutation({
    mutationFn: () => api.checkSentence(selectedWord!.word_id, sentence),
    onSuccess: (res) => {
      setResult(res);
    },
  });

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

  const handleWordSelect = (word: LearnedWordItem) => {
    setSelectedWord(word);
    setSentence("");
    setResult(null);
  };

  const handleCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWord || !sentence.trim() || check.isPending) return;
    check.mutate();
  };

  const filteredWords = words.filter((w) =>
    w.lemma.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.translation_tr.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3">
        <Link to="/vocab">
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <PageHeader 
          title="Sentence Building Practice"
          description="Reinforce retention by using learned words in sentences"
          action={
            <Link to="/vocab/drill">
              <Button size="sm" variant="outline" className="gap-2">
                <Shuffle className="size-3.5" />
                Word Substitution Drill
              </Button>
            </Link>
          }
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground p-6 text-center">Loading your word list...</p>
      ) : words.length === 0 ? (
        <Card className="bg-card/75 border-border/60 shadow-lg p-8 text-center max-w-md mx-auto space-y-4">
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <BookOpen className="size-12 text-primary/40 animate-pulse" />
            <h3 className="font-bold text-lg">No Learned Words Yet</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              To practice sentences, first study words in the vocabulary section or mark words as "known" in reading passages.
            </p>
            <Link to="/vocab" className="pt-2">
              <Button>
                Go to Vocabulary
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          
          {/* Left Column: Word Selection List */}
          <Card className="md:col-span-1 h-[600px] flex flex-col overflow-hidden">
            <CardHeader className="p-4 border-b border-border/40 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold">My Words ({words.length})</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleRandomSelect}
                  title="Pick Random Word"
                  className="size-8 rounded-lg cursor-pointer shrink-0"
                >
                  <Shuffle className="size-4" />
                </Button>
              </div>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search word or meaning..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </CardHeader>
            <CardContent className="p-2 overflow-y-auto flex-1 space-y-1">
              {filteredWords.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No words match your search.</p>
              ) : (
                filteredWords.map((w) => {
                  const isSelected = selectedWord?.word_id === w.word_id;
                  return (
                    <button
                      key={w.word_id}
                      onClick={() => handleWordSelect(w)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer border",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-xs font-semibold"
                          : "bg-transparent border-transparent text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                      )}
                    >
                      <div className="min-w-0">
                        <p className={cn("font-medium truncate", isSelected ? "text-primary-foreground" : "text-foreground")}>
                          {w.lemma}
                        </p>
                        <p className="text-xs opacity-80 truncate">{w.translation_tr}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {w.level && (
                          <Badge variant={isSelected ? "outline" : "secondary"} className={cn("text-[9px] px-1 py-0.5", isSelected && "border-primary-foreground/40 text-primary-foreground")}>
                            {w.level}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Right Column: Sentence Workspace */}
          <div className="md:col-span-2 space-y-6">
            {!selectedWord ? (
              <Card className="h-[400px] flex items-center justify-center border-dashed border-border/70 bg-secondary/5">
                <CardContent className="text-center text-muted-foreground space-y-2">
                  <BookOpen className="size-10 mx-auto text-muted-foreground/45" />
                  <p className="text-sm font-medium">Select a word from the left to practice.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                
                {/* Selected Word Details Card */}
                <Card className="bg-card border border-border/60 shadow-xs">
                  <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-2xl font-bold tracking-tight">{selectedWord.lemma}</h2>
                        {selectedWord.level && (
                          <Badge variant="secondary" className="px-2 py-0.5 text-[10px] font-bold">
                            {selectedWord.level}
                          </Badge>
                        )}
                        {selectedWord.word_type && (
                          <Badge variant="outline" className="px-2 py-0.5 text-[10px] text-blue-600 border-blue-200 bg-blue-50/50 uppercase">
                            {getWordTypeLabel(selectedWord.word_type)}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-sm font-medium text-primary/95 mt-1">
                        {selectedWord.translation_tr}
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRandomSelect}
                      className="gap-1.5 cursor-pointer shrink-0"
                    >
                      <Shuffle className="size-3.5" />
                      Random Word
                    </Button>
                  </CardHeader>
                  
                  {selectedWord.example && (
                    <CardContent className="pt-0 pb-4 border-t border-border/20 mt-2">
                      <div className="bg-secondary/25 border border-border/30 rounded-xl p-3 text-xs space-y-1">
                        <span className="font-bold text-muted-foreground text-[9px] uppercase tracking-wider block">Dictionary Example Sentence</span>
                        <p className="text-foreground/90 font-medium italic">"{selectedWord.example}"</p>
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Input Card */}
                <Card className="shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <Sparkles className="size-4 text-primary" />
                      Write Your Sentence
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Make sure to use <strong>{selectedWord.lemma}</strong> in your sentence.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <form onSubmit={handleCheck} className="space-y-4">
                      <textarea
                        placeholder={`Write a sentence using "${selectedWord.lemma}"...`}
                        value={sentence}
                        onChange={(e) => setSentence(e.target.value)}
                        className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 leading-relaxed"
                        disabled={check.isPending}
                      />
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          disabled={check.isPending || !sentence.trim()}
                          className="disabled:opacity-50 gap-2 px-6"
                        >
                          {check.isPending ? (
                            <>AI is checking...</>
                          ) : (
                            <>
                              <Send className="size-4" />
                              Check
                            </>
                          )}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                {/* Evaluation Results Card */}
                {result && (
                  <Card className={cn(
                    "border shadow-md animate-in fade-in duration-300",
                    result.is_correct ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"
                  )}>
                    <CardHeader className="pb-3 border-b border-border/40">
                      <div className="flex items-center gap-3">
                        {result.is_correct ? (
                          <CheckCircle2 className="size-6 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="size-6 text-destructive shrink-0" />
                        )}
                        <div>
                          <CardTitle className="text-base font-bold">
                            {result.is_correct ? "Great! Your sentence is correct" : "Corrections needed"}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {result.target_word_used_correctly
                              ? "The word was used in the correct context."
                              : "There is an error in word usage or structure."}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-5">
                      
                      {/* Corrections list */}
                      {result.corrections && result.corrections.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Errors and Corrections</p>
                          <div className="space-y-2">
                            {result.corrections.map((c, i) => (
                              <div key={i} className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm space-y-1 shadow-2xs">
                                <p className="font-semibold">
                                  <span className="text-destructive line-through mr-2">{c.wrong}</span>
                                  <span className="text-emerald-500">→ {c.correct}</span>
                                </p>
                                <p className="text-xs text-muted-foreground/90">{c.explanation_tr}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Natural Alternative */}
                      {result.natural_alternative && (
                        <div className="bg-secondary/40 border border-border/30 rounded-xl p-4 space-y-1.5 shadow-2xs">
                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1.5">
                            <Lightbulb className="size-3.5 text-amber-500" /> Alternative Sentence Suggestion
                          </p>
                          <p className="text-sm font-semibold italic text-foreground">"{result.natural_alternative}"</p>
                        </div>
                      )}

                      {/* Feedback Text */}
                      {result.feedback_tr && (
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-1.5 shadow-2xs">
                          <p className="text-[10px] text-primary uppercase font-bold tracking-wider flex items-center gap-1.5">
                            <HelpCircle className="size-3.5" /> Teacher Feedback
                          </p>
                          <p className="text-xs leading-relaxed text-foreground/90">{result.feedback_tr}</p>
                        </div>
                      )}

                    </CardContent>
                  </Card>
                )}

              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
