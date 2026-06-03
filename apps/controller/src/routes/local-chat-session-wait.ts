export const LOCAL_CHAT_SESSION_DISCOVERY_TIMEOUT_MS = 15_000;
export const LOCAL_CHAT_SESSION_DISCOVERY_INTERVAL_MS = 200;
export const LOCAL_CHAT_SESSION_DISCOVERY_MAX_ATTEMPTS =
  Math.floor(
    LOCAL_CHAT_SESSION_DISCOVERY_TIMEOUT_MS /
      LOCAL_CHAT_SESSION_DISCOVERY_INTERVAL_MS,
  ) + 1;

export interface LocalChatSessionDiscoveryResult<TSession> {
  session: TSession | null;
  attempts: number;
  elapsedMs: number;
  timedOut: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForLocalChatSession<TSession>({
  lookupSession,
  maxAttempts = LOCAL_CHAT_SESSION_DISCOVERY_MAX_ATTEMPTS,
  intervalMs = LOCAL_CHAT_SESSION_DISCOVERY_INTERVAL_MS,
  wait = delay,
  now = () => Date.now(),
}: {
  lookupSession: () => Promise<TSession | null>;
  maxAttempts?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<LocalChatSessionDiscoveryResult<TSession>> {
  const startedAt = now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await lookupSession();
    if (session) {
      return {
        session,
        attempts: attempt,
        elapsedMs: Math.max(0, now() - startedAt),
        timedOut: false,
      };
    }

    if (attempt < maxAttempts) {
      await wait(intervalMs);
    }
  }

  return {
    session: null,
    attempts: maxAttempts,
    elapsedMs: Math.max(0, now() - startedAt),
    timedOut: true,
  };
}
