import type { CardComponent as CardComp } from "../a2ui-types";

interface Props {
  comp: CardComp;
  resolve: <T>(val: T) => unknown;
  children: React.ReactNode;
}

export function CardComponent({ comp, resolve, children }: Props) {
  const padding = resolve(comp.padding) as number | undefined;
  const elevation = resolve(comp.elevation) as number | undefined;

  return (
    <div
      className="a2ui-card"
      style={{
        padding: padding != null ? `${padding}px` : undefined,
        boxShadow:
          elevation != null
            ? `0 ${elevation}px ${elevation * 2}px rgba(0,0,0,0.1)`
            : undefined,
      }}
    >
      {children}
    </div>
  );
}
