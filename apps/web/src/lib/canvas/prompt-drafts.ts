/**
 * prompt-drafts.ts
 *
 * Module-level Map<nodeId, string> for per-node prompt drafts.
 * Survives selection changes but is NOT persisted across page reloads.
 *
 * Subscribable (useSyncExternalStore) so writers OUTSIDE the prompt panel —
 * the prompt-library dialog inserting a picked prompt — update an open
 * panel immediately.
 */

import { useSyncExternalStore } from "react";

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getDraft(nodeId: string): string {
  return drafts.get(nodeId) ?? "";
}

export function setDraft(nodeId: string, value: string): void {
  drafts.set(nodeId, value);
  emit();
}

/** React hook — the draft for one node, reactive to any setDraft call. */
export function useDraft(nodeId: string): string {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => getDraft(nodeId),
    () => getDraft(nodeId),
  );
}

/** Reset all drafts — tests only. */
export function resetDraftsForTests(): void {
  drafts.clear();
  emit();
}
