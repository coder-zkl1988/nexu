import type {
  AgentBrowserCommand,
  AgentBrowserObservation,
  AgentBrowserSnapshot,
} from "@nexu/shared";

/**
 * Wire and evidence helpers for agent browser control, kept free of Electron
 * imports so they can be tested without a running app.
 */

export type CommandEnvelope = {
  requestId: string;
  sessionKey: string;
  command: AgentBrowserCommand;
};

/** Parses one SSE frame, returning an envelope only for `command` events. */
export function parseCommandFrame(frame: string): CommandEnvelope | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (event !== "command" || data.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(data.join("\n"));
    if (!parsed || typeof parsed !== "object") return null;
    const { requestId, sessionKey, command } = parsed as CommandEnvelope;
    if (typeof requestId !== "string" || typeof sessionKey !== "string") {
      return null;
    }
    if (!command || typeof command !== "object") return null;
    return { requestId, sessionKey, command };
  } catch {
    return null;
  }
}

/**
 * Splits a stream buffer into complete SSE frames, returning the unconsumed
 * remainder so the next chunk can finish a partial frame.
 */
export function drainFrames(buffer: string): {
  frames: string[];
  rest: string;
} {
  const frames: string[] = [];
  let rest = buffer;
  let boundary = rest.indexOf("\n\n");
  while (boundary !== -1) {
    frames.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf("\n\n");
  }
  return { frames, rest };
}

/**
 * Builds the evidence returned for a mutating command.
 *
 * The element is reported only when the page stayed put. Navigation resets the
 * ref table, so the same ref on the new page is an unrelated element — handing
 * it back would answer "here is what you acted on" with something the agent
 * never touched.
 */
export function buildObservation(
  after: AgentBrowserSnapshot,
  ref: string,
  urlBefore: string,
): AgentBrowserObservation {
  const navigated = after.url !== urlBefore;
  const element = navigated
    ? undefined
    : after.nodes.find((node) => node.ref === ref);
  return {
    url: after.url,
    title: after.title,
    ...(element ? { element } : {}),
    navigated,
  };
}
