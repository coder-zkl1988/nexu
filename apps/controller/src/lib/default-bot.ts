import type { BotResponse } from "@nexu/shared";

/**
 * The minimal config slice the default-bot resolver needs. `NexuConfig`
 * satisfies this structurally, so both the compiler and services can pass
 * their config object directly.
 */
type DefaultBotConfigSlice = {
  bots: BotResponse[];
  desktop: Record<string, unknown>;
};

export function readDesktopDefaultBotId(
  desktop: Record<string, unknown>,
): string | null {
  const value = desktop.defaultBotId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Single source of truth for "which bot is the desktop default".
 * Precedence (design: specs/design-docs/2026-07-23-desktop-default-bot-and-system-bot.md):
 *   1. desktop.defaultBotId, when it points at an active bot (stale ids are ignored)
 *   2. the active system bot
 *   3. the first active bot in slug order (matches the compiler's agents.list order)
 *   4. null — callers that must have a bot lazily create the system bot
 */
export function resolveDefaultBotFromConfig(
  config: DefaultBotConfigSlice,
): BotResponse | null {
  const activeBots = config.bots.filter((bot) => bot.status === "active");

  const configuredId = readDesktopDefaultBotId(config.desktop);
  if (configuredId) {
    const configured = activeBots.find((bot) => bot.id === configuredId);
    if (configured) {
      return configured;
    }
  }

  const systemBot = activeBots.find((bot) => bot.origin === "system");
  if (systemBot) {
    return systemBot;
  }

  const sorted = [...activeBots].sort((left, right) =>
    left.slug.localeCompare(right.slug),
  );
  return sorted[0] ?? null;
}
