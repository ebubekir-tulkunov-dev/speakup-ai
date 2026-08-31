/** Canonical English values for chat sessions (stored in API / sent to AI). */
export const FREE_CHAT_SCENARIO = "Free conversation";
export const DEFAULT_TENSE = "General";
export const NEW_CHAT_TITLE = "New chat";

const LEGACY_SCENARIO: Record<string, string> = {
  "Serbest sohbet": FREE_CHAT_SCENARIO,
};

const LEGACY_TENSE: Record<string, string> = {
  Genel: DEFAULT_TENSE,
};

const LEGACY_TITLE: Record<string, string> = {
  "Yeni sohbet": NEW_CHAT_TITLE,
};

export function normalizeScenario(scenario: string): string {
  return LEGACY_SCENARIO[scenario] ?? scenario;
}

export function normalizeTense(tense: string): string {
  return LEGACY_TENSE[tense] ?? tense;
}

export function displayScenario(scenario: string): string {
  return normalizeScenario(scenario);
}

export function displayTense(tense: string): string {
  return normalizeTense(tense);
}

export function displayChatTitle(title: string): string {
  return LEGACY_TITLE[title] ?? title;
}

export function isFreeChatScenario(scenario: string): boolean {
  return normalizeScenario(scenario) === FREE_CHAT_SCENARIO;
}

export function isDefaultTense(tense: string): boolean {
  return normalizeTense(tense) === DEFAULT_TENSE;
}
