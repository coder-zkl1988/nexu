import { useSyncExternalStore } from "react";

export interface BrowserPanelState {
  isOpen: boolean;
  sessionKey: string | null;
}

const CLOSED_STATE: BrowserPanelState = {
  isOpen: false,
  sessionKey: null,
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

export function openBrowserPanel(sessionKey: string): void {
  state = { isOpen: true, sessionKey };
  emit();
}

export function closeBrowserPanel(): void {
  if (!state.isOpen && state.sessionKey === null) return;
  state = CLOSED_STATE;
  emit();
}

export function closeBrowserPanelForSessionNavigation(
  previousPath: string | null,
  nextPath: string,
): boolean {
  if (previousPath === null || previousPath === nextPath) return false;
  closeBrowserPanel();
  return true;
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
