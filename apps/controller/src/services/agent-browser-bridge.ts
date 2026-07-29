import { randomUUID } from "node:crypto";
import type { AgentBrowserCommand, AgentBrowserOutcome } from "@nexu/shared";

/**
 * Routes agent browser commands to the desktop renderer and waits for the
 * renderer's answer.
 *
 * In-memory and single-subscriber by design: this is a single-user local app,
 * and the thing on the other end is one desktop window's browser panel. A new
 * subscriber replaces the previous one rather than joining it — broadcasting a
 * click to two panels would perform it twice.
 */

export type AgentBrowserEnvelope = {
  requestId: string;
  sessionKey: string;
  command: AgentBrowserCommand;
};

export type AgentBrowserSubscriber = (envelope: AgentBrowserEnvelope) => void;

export const AGENT_BROWSER_TIMEOUT_MS = 30_000;

/** No panel to execute in. Callers turn this into guidance for the model. */
export class AgentBrowserUnavailableError extends Error {
  constructor() {
    super("no desktop browser panel is listening");
    this.name = "AgentBrowserUnavailableError";
  }
}

export class AgentBrowserTimeoutError extends Error {
  constructor() {
    super("the desktop browser panel did not answer in time");
    this.name = "AgentBrowserTimeoutError";
  }
}

type Pending = {
  resolve: (outcome: AgentBrowserOutcome) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Who this went to, so a different subscriber's exit cannot fail it. */
  owner: AgentBrowserSubscriber;
};

export class AgentBrowserBridge {
  private subscriber: AgentBrowserSubscriber | null = null;
  private pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs = AGENT_BROWSER_TIMEOUT_MS) {}

  isConnected(): boolean {
    return this.subscriber !== null;
  }

  subscribe(subscriber: AgentBrowserSubscriber): () => void {
    this.subscriber = subscriber;
    return () => {
      if (this.subscriber === subscriber) this.subscriber = null;
      // Fail only what this subscriber was actually given: a command dispatched
      // to a newer connection must survive an older one's teardown. A desktop
      // that reconnects — after a controller restart, say — otherwise kills the
      // request that is running right now, and the agent is told there is no
      // browser while one is plainly connected.
      for (const [requestId, pending] of this.pending) {
        if (pending.owner !== subscriber) continue;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.reject(new AgentBrowserUnavailableError());
      }
    };
  }

  async dispatch(
    sessionKey: string,
    command: AgentBrowserCommand,
  ): Promise<AgentBrowserOutcome> {
    const subscriber = this.subscriber;
    if (!subscriber) throw new AgentBrowserUnavailableError();

    // Correlation only, never surfaced — no need for a public cuid2 id (and no
    // reason to pull that dependency into the controller's runtime closure).
    const requestId = randomUUID();
    const outcome = new Promise<AgentBrowserOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new AgentBrowserTimeoutError());
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        owner: subscriber,
      });
    });

    try {
      subscriber({ requestId, sessionKey, command });
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
      }
      throw error instanceof Error ? error : new Error(String(error));
    }

    return outcome;
  }

  /** Returns false when nobody is waiting — the request already timed out. */
  settle(requestId: string, outcome: AgentBrowserOutcome): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(outcome);
    return true;
  }
}
