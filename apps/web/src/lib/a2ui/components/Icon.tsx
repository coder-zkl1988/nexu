import { icons } from "lucide-react";
import type { IconComponent as IconComp } from "../a2ui-types";

interface Props {
  comp: IconComp;
  resolve: <T>(val: T) => unknown;
}

/** "arrow-right" / "check_circle" / "star" → "ArrowRight" / "CheckCircle" / "Star" */
function toLucideName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function IconComponent({ comp, resolve }: Props) {
  const name = String(resolve(comp.name) ?? "");
  const color = comp.color ? String(resolve(comp.color) ?? "") : undefined;
  const size = resolve(comp.size) as number | undefined;

  const LucideIcon = icons[toLucideName(name) as keyof typeof icons];
  if (LucideIcon) {
    return (
      <span
        className="a2ui-icon"
        style={{ color, display: "inline-flex", alignItems: "center" }}
        role="img"
        aria-label={comp.accessibility?.label ?? name}
      >
        <LucideIcon size={size ?? 16} />
      </span>
    );
  }

  // Unknown name — fall back to showing the raw name text.
  return (
    <span
      className="a2ui-icon"
      style={{
        color,
        fontSize: size != null ? `${size}px` : undefined,
      }}
      role="img"
      aria-label={comp.accessibility?.label ?? name}
    >
      {name}
    </span>
  );
}
