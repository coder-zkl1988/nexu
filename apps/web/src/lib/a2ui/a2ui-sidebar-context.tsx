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
    opts?: {
      title?: string;
      position?: { x: number; y: number };
      size?: { width: number; height: number };
    },
  ) => void;
  /** Collapse the workbench panel; nodes stay for the next open. */
  close: () => void;
}

/**
 * Default node size for XHS editor surfaces — matched to the size users keep
 * hand-resizing the editor to (comfortable title + body + hashtags + publish
 * row without inner scrolling).
 */
export const XHS_EDITOR_NODE_SIZE = { width: 580, height: 625 };

/**
 * Component-aware default node size for a sidebar surface. XHSEditor cards
 * get the editor-friendly size; everything else falls back to the store's
 * generic a2ui default (undefined).
 */
export function sidebarSurfaceDefaultSize(
  msgs: A2UIMessage[],
): { width: number; height: number } | undefined {
  for (const m of msgs) {
    if (!("updateComponents" in m)) continue;
    for (const comp of m.updateComponents?.components ?? []) {
      if ((comp as { type?: string }).type === "XHSEditor") {
        return XHS_EDITOR_NODE_SIZE;
      }
    }
  }
  return undefined;
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
          { position: opts?.position, size: opts?.size },
        );
      },
      close: () => setPanelOpen(false),
    }),
    [panelOpen],
  );
}
