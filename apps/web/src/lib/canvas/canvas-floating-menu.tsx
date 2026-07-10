/**
 * canvas-floating-menu.tsx
 *
 * Shared presentational shell for the canvas context menu and connect menu.
 * Both menus have the same visual frame; only their children differ.
 *
 * Exports:
 *   - clampMenuPosition: pure clamp helper (unit-testable)
 *   - FloatingMenu: small wrapper component
 */

import type { ReactNode } from "react";

// ── Clamp helper ───────────────────────────────────────────────────

const MENU_DEFAULT_WIDTH = 180;
const MENU_DEFAULT_HEIGHT = 170;
const FLOOR = 8;

/**
 * Clamp a menu's top-left position so it stays inside the container.
 *
 * @param x               Requested left position (container-relative px).
 * @param y               Requested top position (container-relative px).
 * @param containerWidth  Container width in px.
 * @param containerHeight Container height in px.
 * @param menuWidth       Estimated menu width (default 180).
 * @param menuHeight      Estimated menu height (default 170).
 * @returns Clamped { x, y } still in container-relative px.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
  menuWidth = MENU_DEFAULT_WIDTH,
  menuHeight = MENU_DEFAULT_HEIGHT,
): { x: number; y: number } {
  return {
    x: Math.max(FLOOR, Math.min(x, containerWidth - menuWidth - FLOOR)),
    y: Math.max(FLOOR, Math.min(y, containerHeight - menuHeight - FLOOR)),
  };
}

// ── FloatingMenu component ─────────────────────────────────────────

interface FloatingMenuProps {
  /** Container-relative left position (already clamped). */
  x: number;
  /** Container-relative top position (already clamped). */
  y: number;
  /** data-* attribute name:value pair to set on the root element. */
  dataAttr: { name: string; value: string };
  children: ReactNode;
}

/**
 * Shared floating menu shell for the canvas: absolutely positioned,
 * with opaque surface, border, shadow, and stopPropagation on pointerdown
 * (so clicking a menu item does not trigger container pan/marquee).
 */
export function FloatingMenu({ x, y, dataAttr, children }: FloatingMenuProps) {
  return (
    <div
      {...{ [dataAttr.name]: dataAttr.value }}
      className="absolute z-50 min-w-[140px] rounded-lg border border-border bg-surface-1/95 py-1 shadow-md text-xs"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
