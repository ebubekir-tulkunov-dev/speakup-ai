export type DisabledFeatureKey = "topWords" | "journal" | "lyrics" | "tenses";

export const DISABLED_FEATURES: Record<
  DisabledFeatureKey,
  { title: string; description: string }
> = {
  topWords: {
    title: "Top 100 Words",
    description:
      "This section is temporarily unavailable while we improve word ranking and frequency algorithms.",
  },
  journal: {
    title: "Journal",
    description:
      "Daily journaling with AI correction is temporarily unavailable while we refine the feedback pipeline.",
  },
  lyrics: {
    title: "Lyrics Practice",
    description:
      "Line-by-line lyrics translation is temporarily unavailable while we improve translation quality.",
  },
  tenses: {
    title: "Tenses",
    description:
      "Tense lessons and exercises are temporarily unavailable while we rework the learning flow.",
  },
};
