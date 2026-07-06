/**
 * canvas-dialogs.ts — module store for canvas overlay dialogs (W3.2).
 *
 * Pattern mirrors canvas-store (useSyncExternalStore, zero deps).
 *
 * CanvasDialogState is an extensible kind union so future tasks can add
 * split / upscale / mask / angle dialogs without touching this store.
 */

import { useSyncExternalStore } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type CanvasDialogState = { kind: "crop"; nodeId: string } | null;

// ── Store internals ────────────────────────────────────────────────────────

let state: CanvasDialogState = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

// ── Actions ────────────────────────────────────────────────────────────────

export function openCanvasDialog(
  dialogState: NonNullable<CanvasDialogState>,
): void {
  state = dialogState;
  emit();
}

export function closeCanvasDialog(): void {
  state = null;
  emit();
}

// ── Selectors ──────────────────────────────────────────────────────────────

export function getCanvasDialog(): CanvasDialogState {
  return state;
}

export function useCanvasDialog(): CanvasDialogState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => state,
  );
}

// ── Test helper ────────────────────────────────────────────────────────────

export function __resetCanvasDialogsForTests(): void {
  state = null;
  emit();
}
