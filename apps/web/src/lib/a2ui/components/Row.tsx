import type { RowComponent as RowComp } from "../a2ui-types";

interface Props {
  comp: RowComp;
  resolve: <T>(val: T) => unknown;
  children: React.ReactNode;
}

export function RowComponent({ comp, resolve, children }: Props) {
  const gap = resolve(comp.gap) as number | undefined;
  const alignment =
    (resolve(comp.alignment) as RowComp["alignment"]) ?? "start";

  return (
    <div
      className="a2ui-row"
      style={{
        display: "flex",
        flexDirection: "row",
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
