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
 * refs — alive under a fixed id.
 */

export interface AgentBrowserTabRequest {
  tabId: string;
  url: string;
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

export function requestAgentBrowserTab(tabId: string, url: string): void {
  request = { tabId, url, nonce: ++nonce };
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
