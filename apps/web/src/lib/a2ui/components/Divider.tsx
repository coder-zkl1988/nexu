import type { DividerComponent as DividerComp } from "../a2ui-types";

interface Props {
  comp: DividerComp;
  resolve: <T>(val: T) => unknown;
}

export function DividerComponent({ comp, resolve }: Props) {
  const orientation =
    (resolve(comp.orientation) as DividerComp["orientation"]) ?? "horizontal";
  const thickness = resolve(comp.thickness) as number | undefined;
  const color = comp.color ? String(resolve(comp.color) ?? "") : undefined;

  return (
    <hr
      className={`a2ui-divider a2ui-divider--${orientation}`}
      style={{
        borderWidth: thickness != null ? `${thickness}px` : undefined,
        borderColor: color,
      }}
    />
  );
}
