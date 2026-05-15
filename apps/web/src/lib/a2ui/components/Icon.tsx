import type { IconComponent as IconComp } from "../a2ui-types";

interface Props {
  comp: IconComp;
  resolve: <T>(val: T) => unknown;
}

export function IconComponent({ comp, resolve }: Props) {
  const name = String(resolve(comp.name) ?? "");
  const color = comp.color ? String(resolve(comp.color) ?? "") : undefined;
  const size = resolve(comp.size) as number | undefined;

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
