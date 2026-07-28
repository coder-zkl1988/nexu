import type { AgentBrowserCommand, AgentBrowserOutcome } from "@nexu/shared";

/**
 * Renderer half of agent browser control.
 *
 * The agent's command arrives over SSE at the workspace layout, which is always
 * mounted; the thing that can actually execute it is the browser panel, which
 * is not. So the panel registers an executor here when it mounts, and the
 * layout opens the panel and waits for that registration before dispatching.
 *
 * The registration is what keeps "the user can see it" true: with no panel
 * mounted there is no executor, and the command fails with an explanation
 * instead of running invisibly.
 */

export type AgentBrowserExecutor = (
  command: AgentBrowserCommand,
) => Promise<AgentBrowserOutcome>;

let executor: AgentBrowserExecutor | null = null;
const waiters = new Set<(executor: AgentBrowserExecutor) => void>();

export function registerAgentBrowserExecutor(
  next: AgentBrowserExecutor,
): () => void {
  executor = next;
  for (const waiter of waiters) waiter(next);
  waiters.clear();
  return () => {
    if (executor === next) executor = null;
  };
}

/**
 * The panel that is mounted right now, or null.
 *
 * Callers must read this immediately before acting rather than holding the
 * value returned by `waitForAgentBrowserPanel`. A panel can unmount while a
 * command is in flight, and a captured reference keeps working afterwards —
 * it drives a browser view nobody can see, which is the one thing this design
 * exists to prevent.
 */
export function getAgentBrowserExecutor(): AgentBrowserExecutor | null {
  return executor;
}

/** Resolves once a panel mounts, or false if none does before `timeoutMs`. */
export function waitForAgentBrowserPanel(timeoutMs: number): Promise<boolean> {
  if (executor) return Promise.resolve(true);
  return new Promise((resolve) => {
    const waiter = (): void => {
      window.clearTimeout(timer);
      resolve(true);
    };
    const timer = window.setTimeout(() => {
      waiters.delete(waiter);
      resolve(false);
    }, timeoutMs);
    waiters.add(waiter);
  });
}

/**
 * URL the agent asked for, read by the panel as it mounts. A plain slot rather
 * than a queue: only the newest request is worth honouring, and an unread one
 * is stale the moment the next arrives.
 */
let pendingOpenUrl: string | null = null;

export function requestAgentBrowserOpen(url: string): void {
  pendingOpenUrl = url;
}

export function takeAgentBrowserOpenUrl(): string | null {
  const url = pendingOpenUrl;
  pendingOpenUrl = null;
  return url;
}

export function resetAgentBrowserRelayForTests(): void {
  executor = null;
  waiters.clear();
  pendingOpenUrl = null;
}
