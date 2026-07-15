/**
 * param-pills.tsx — shared pill-style parameter controls (reference 图像设置
 * paradigm). Used by the prompt panel's settings popover and the config
 * node's settings section.
 */

import type { ReactNode } from "react";

/** Labeled pill group inside a settings popover/section. */
export function SettingsGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="pb-2.5 last:pb-0">
      <p className="pb-1.5 text-[11px] font-medium text-text-tertiary">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Selectable pill button. */
export function ParamPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-text-primary text-text-primary"
          : "border-border text-text-secondary hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
