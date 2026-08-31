export const NATIVE_LANGUAGES = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "uk", label: "Українська" },
] as const;

const LABELS = Object.fromEntries(NATIVE_LANGUAGES.map((l) => [l.code, l.label]));

/** Endonym labels (Türkçe, Русский, …) — settings dropdowns */
export function nativeLanguageLabel(code?: string | null): string {
  if (!code) return "—";
  return LABELS[code] ?? code.toUpperCase();
}

/** English UI labels — buttons, page copy */
const UI_LABELS: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  ru: "Russian",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
};

export function languageUiLabel(code?: string | null): string {
  if (!code) return "—";
  return UI_LABELS[code] ?? nativeLanguageLabel(code);
}

/** BCP 47 tags for text-to-speech */
export const SPEECH_LOCALES: Record<string, string> = {
  tr: "tr-TR",
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  ar: "ar-SA",
  ru: "ru-RU",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  pt: "pt-PT",
  it: "it-IT",
  nl: "nl-NL",
  pl: "pl-PL",
  uk: "uk-UA",
};

export function speechLocale(code?: string | null): string {
  if (!code) return "en-US";
  return SPEECH_LOCALES[code] ?? `${code}-${code.toUpperCase()}`;
}
