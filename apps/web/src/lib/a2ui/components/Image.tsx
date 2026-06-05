import type { ImageComponent as ImageComp } from "../a2ui-types";

interface Props {
  comp: ImageComp;
  resolve: <T>(val: T) => unknown;
}

export function ImageComponent({ comp, resolve }: Props) {
  const source = String(resolve(comp.source) ?? "");
  const alt = comp.alt ? String(resolve(comp.alt) ?? "") : "";
  const width = resolve(comp.width) as number | undefined;
  const height = resolve(comp.height) as number | undefined;
  const objectFit =
    (resolve(comp.objectFit) as ImageComp["objectFit"]) ?? "cover";

  return (
    <img
      className="a2ui-image"
      src={source}
      alt={alt}
      style={{
        width: width != null ? `${width}px` : undefined,
        height: height != null ? `${height}px` : undefined,
        objectFit,
      }}
    />
  );
}
