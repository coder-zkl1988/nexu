/**
 * Display names for model providers.
 *
 * Pickers group models by `provider`, which is the raw provider id ("nexu",
 * "glm", …). Rendering that id directly leaks an internal name into the UI —
 * the Tabby Official group showed up as "NEXU" — and gives vendors whose id
 * differs from their brand the wrong label too.
 */
const PROVIDER_LABELS: Record<string, string> = {
  nexu: "Tabby Official",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI Studio",
  siliconflow: "SiliconFlow",
  ppio: "PPIO",
  openrouter: "OpenRouter",
  minimax: "MiniMax",
  kimi: "Moonshot",
  glm: "Zhipu",
  moonshot: "Moonshot",
  zai: "Zhipu",
};

/** The provider's display name, falling back to its id when unmapped. */
export function getProviderLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}
