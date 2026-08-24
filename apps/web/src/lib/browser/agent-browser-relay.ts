import { useSyncExternalStore } from "react";

/**
 * Renderer half of agent browser control.
 *
 * The agent's commands are executed in the main process, which owns the browser
 * view; the renderer's only job is to put that view on screen. When the agent
 * opens a page the main process announces the tab it drove, and the panel
 * adopts it by id.
 *
 * The tab id is the whole reason this works across a collapsed panel: the
 * renderer's own tab ids live in React state and do not survive an unmount,
 * while the main process keeps the tab — and its page, login state and element
 * refs — alive under an id derived from the driving session.
 *
 * The request carries that session so the panel can refuse a page that belongs
 * to a different conversation, and is cleared when the run ends: a request
 * left standing was re-adopted by every later panel mount, which is how a page
 * outlived the conversation that opened it — deleting the session included.
 */

export interface AgentBrowserTabRequest {
  tabId: string;
  url: string;
  sessionKey: string;
  /** Distinguishes two consecutive opens of the same URL. */
  nonce: number;
}

let request: AgentBrowserTabRequest | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestAgentBrowserTab(
  tabId: string,
  url: string,
  sessionKey: string,
): void {
  request = { tabId, url, sessionKey, nonce: ++nonce };
  emit();
}

/**
 * Drops the standing request once its run is over.
 *
 * Without this the last page the agent opened is re-adopted every time the
 * panel mounts again, in any conversation, for the life of the renderer.
 */
export function clearAgentBrowserTabRequest(sessionKey: string): void {
  if (request?.sessionKey !== sessionKey) return;
  request = null;
  emit();
}

export function getAgentBrowserTabRequest(): AgentBrowserTabRequest | null {
  return request;
}

export function useAgentBrowserTabRequest(): AgentBrowserTabRequest | null {
  return useSyncExternalStore(
    subscribe,
    getAgentBrowserTabRequest,
    getAgentBrowserTabRequest,
  );
}

export function resetAgentBrowserRelayForTests(): void {
  request = null;
  nonce = 0;
  emit();
}
