import type { TextComponent as TextComp } from "../a2ui-types";

interface Props {
  comp: TextComp;
  resolve: <T>(val: T) => unknown;
}

export function TextComponent({ comp, resolve }: Props) {
  const content = String(resolve(comp.content) ?? "");
  const variant = resolve(comp.variant) as TextComp["variant"];

  const className = `a2ui-text a2ui-text--${variant ?? "body"}`;

  if (variant === "h1") return <h1 className={className}>{content}</h1>;
  if (variant === "h2") return <h2 className={className}>{content}</h2>;
  if (variant === "h3") return <h3 className={className}>{content}</h3>;
  if (variant === "h4") return <h4 className={className}>{content}</h4>;
  if (variant === "h5") return <h5 className={className}>{content}</h5>;
  if (variant === "code") return <code className={className}>{content}</code>;
  if (variant === "caption")
    return <small className={className}>{content}</small>;
  return <p className={className}>{content}</p>;
}
