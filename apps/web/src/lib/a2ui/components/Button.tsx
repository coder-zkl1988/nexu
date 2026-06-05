import type { ButtonComponent as ButtonComp } from "../a2ui-types";

interface Props {
  comp: ButtonComp;
  resolve: <T>(val: T) => unknown;
  onAction?: (name: string, context: Record<string, unknown>) => void;
}

export function ButtonComponent({ comp, resolve, onAction }: Props) {
  const label = String(resolve(comp.label) ?? "");
  const variant = (resolve(comp.variant) as ButtonComp["variant"]) ?? "primary";
  const disabled = resolve(comp.disabled) === true;

  function handleClick() {
    if (!comp.action || disabled) return;
    if ("event" in comp.action) {
      onAction?.(comp.action.event.name, comp.action.event.context ?? {});
    }
  }

  return (
    <button
      type="button"
      className={`a2ui-button a2ui-button--${variant}`}
      disabled={disabled}
      onClick={handleClick}
    >
      {label}
    </button>
  );
}
