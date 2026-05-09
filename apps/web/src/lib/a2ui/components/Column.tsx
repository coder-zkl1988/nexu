import type { ColumnComponent as ColumnComp } from "../a2ui-types";

interface Props {
  comp: ColumnComp;
  resolve: <T>(val: T) => unknown;
  children: React.ReactNode;
}

export function ColumnComponent({ comp, resolve, children }: Props) {
  const gap = resolve(comp.gap) as number | undefined;
  const alignment =
    (resolve(comp.alignment) as ColumnComp["alignment"]) ?? "start";

  return (
    <div
      className="a2ui-column"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: gap != null ? `${gap}px` : undefined,
        alignItems: mapAlignment(alignment),
      }}
    >
      {children}
    </div>
  );
}

function mapAlignment(a: string): string {
  switch (a) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
}
