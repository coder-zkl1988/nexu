export interface LocalChatSession {
  id: string;
  [key: string]: unknown;
}

export type LocalChatSessionLookup = (input: {
  query: {
    botId: string;
    sessionKey: string;
  };
}) => Promise<{
  data?: {
    session?: LocalChatSession | null;
  } | null;
}>;

const DEFAULT_MAX_ATTEMPTS = 60;
const DEFAULT_INTERVAL_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForLocalChatSession({
  botId,
  sessionKey,
  initialSession,
  lookupSession,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  shouldContinue = () => true,
  delay: wait = delay,
}: {
  botId: string;
  sessionKey: string;
  initialSession?: LocalChatSession | null;
  lookupSession: LocalChatSessionLookup;
  maxAttempts?: number;
  intervalMs?: number;
  shouldContinue?: () => boolean;
  delay?: (ms: number) => Promise<void>;
}): Promise<LocalChatSession | null> {
  if (initialSession?.id) {
    return initialSession;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!shouldContinue()) {
      return null;
    }

    const response = await lookupSession({
      query: {
        botId,
        sessionKey,
      },
    });
    const session = response.data?.session ?? null;
    if (session?.id) {
      return session;
    }

    if (attempt < maxAttempts - 1) {
      await wait(intervalMs);
    }
  }

  return null;
}
