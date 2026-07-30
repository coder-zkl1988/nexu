import { useSyncExternalStore } from "react";

export interface BrowserPanelState {
  isOpen: boolean;
  sessionKey: string | null;
  /**
   * The agent opened this panel and is working in it.
   *
   * The workbench normally belongs to the conversation view and closes when you
   * navigate away. An agent's page does not: closing it mid-task would take the
   * work off screen and, because the panel is what places the browser view,
   * stop the agent's clicks from landing at all. Only an explicit close ends it.
   */
  openedByAgent: boolean;
}

const CLOSED_STATE: BrowserPanelState = {
  isOpen: false,
  sessionKey: null,
  openedByAgent: false,
};

let state = CLOSED_STATE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBrowserPanelState(): BrowserPanelState {
  return state;
}

export function openBrowserPanel(sessionKey: string, byAgent = false): void {
  state = { isOpen: true, sessionKey, openedByAgent: byAgent };
  emit();
}

export function closeBrowserPanel(): void {
  if (!state.isOpen && state.sessionKey === null) return;
  state = CLOSED_STATE;
  emit();
}

/** Closes only a panel the user opened; an agent's panel survives routing. */
export function closeBrowserPanelForRouting(): boolean {
  if (state.openedByAgent) return false;
  closeBrowserPanel();
  return true;
}

/**
 * The agent's run is over: keep the panel open — the user may be reading the
 * result — but drop the pin, so it goes back to closing on navigation like
 * any other workbench. The pin exists to protect an agent mid-task; without a
 * release it outlives its purpose and glues the panel across routes forever.
 */
export function releaseAgentBrowserPanelPin(): void {
  if (!state.openedByAgent) return;
  state = { ...state, openedByAgent: false };
  emit();
}

export function closeBrowserPanelForSessionNavigation(
  previousPath: string | null,
  nextPath: string,
): boolean {
  if (previousPath === null || previousPath === nextPath) return false;
  return closeBrowserPanelForRouting();
}

export function useBrowserPanel(): BrowserPanelState {
  return useSyncExternalStore(
    subscribe,
    getBrowserPanelState,
    getBrowserPanelState,
  );
}

export function resetBrowserPanelForTests(): void {
  state = CLOSED_STATE;
  emit();
}
