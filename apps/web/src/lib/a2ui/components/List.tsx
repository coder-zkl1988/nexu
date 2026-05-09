import type { ListComponent as ListComp } from "../a2ui-types";

interface Props {
  comp: ListComp;
  resolve: <T>(val: T) => unknown;
  children: React.ReactNode;
}

export function ListComponent({ comp, resolve, children }: Props) {
  const gap = resolve(comp.gap) as number | undefined;
  const orientation =
    (resolve(comp.orientation) as ListComp["orientation"]) ?? "vertical";

  return (
    <div
      className="a2ui-list"
      style={{
        display: "flex",
        flexDirection: orientation === "horizontal" ? "row" : "column",
        gap: gap != null ? `${gap}px` : undefined,
      }}
    >
      {children}
    </div>
  );
}
