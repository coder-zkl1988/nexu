import {
  setPanelOpen,
  upsertA2UINode,
  useCanvas,
} from "@/lib/canvas/canvas-store";
import { useMemo } from "react";
import type { A2UIMessage } from "./a2ui-types";

/**
 * Compatibility bridge over the canvas-v2 store (design doc
 * 2026-07-03-infinite-canvas-sidebar.md). Historically this context owned the
 * right sidebar's single A2UI surface; the workbench store now owns nodes,
 * and this hook keeps the long-standing `openWith` call sites working —
 * each surface becomes (or refreshes) a canvas node.
 */

export type A2UIActionHandler = (
  actionName: string,
  context: Record<string, unknown>,
) => void;

export interface A2UISidebarApi {
  isOpen: boolean;
  /** Pin a surface onto the canvas workbench (and open the panel). */
  openWith: (
    surfaceId: string,
    messages: A2UIMessage[],
    onAction: A2UIActionHandler,
    opts?: { title?: string },
  ) => void;
  /** Collapse the workbench panel; nodes stay for the next open. */
  close: () => void;
}

/** "sidebar:xhs-editor-1" → "xhs editor 1" — fallback node title. */
export function humanizeSurfaceId(surfaceId: string): string {
  return surfaceId
    .replace(/^sidebar:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

/**
 * Provider retained for tree compatibility (tests and layout wrap with it);
 * state itself lives in the module-level canvas store.
 */
export function A2UISidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

export function useA2UISidebar(): A2UISidebarApi {
  const { panelOpen } = useCanvas();
  return useMemo(
    () => ({
      isOpen: panelOpen,
      openWith: (surfaceId, messages, onAction, opts) => {
        upsertA2UINode(
          surfaceId,
          opts?.title ?? humanizeSurfaceId(surfaceId),
          messages,
          onAction,
        );
      },
      close: () => setPanelOpen(false),
    }),
    [panelOpen],
  );
}
