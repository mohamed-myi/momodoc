import type { ChatSource, SearchResult } from "@/lib/types";

export const SEARCH_MODE = "search";

export const MODE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  claude: "Claude",
  openai: "OpenAI",
  ollama: "Ollama",
  search: "Search",
};

export interface UnifiedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  isStreaming?: boolean;
  searchResults?: SearchResult[];
}

export interface ModeOption {
  value: string;
  label: string;
  available: boolean;
  model: string;
}

export type ScoreVariant = "success" | "warning" | "default";

export function getScoreVariant(score: number): ScoreVariant {
  if (score >= 0.8) return "success";
  if (score >= 0.5) return "warning";
  return "default";
}
