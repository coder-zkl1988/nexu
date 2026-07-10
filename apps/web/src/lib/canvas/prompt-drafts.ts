/**
 * prompt-drafts.ts
 *
 * Module-level Map<nodeId, string> for per-node prompt drafts.
 * Survives selection changes but is NOT persisted across page reloads.
 *
 * Exported resetDraftsForTests is test-only.
 */

const drafts = new Map<string, string>();

export function getDraft(nodeId: string): string {
  return drafts.get(nodeId) ?? "";
}

export function setDraft(nodeId: string, value: string): void {
  drafts.set(nodeId, value);
}

/** Reset all drafts — tests only. */
export function resetDraftsForTests(): void {
  drafts.clear();
}
