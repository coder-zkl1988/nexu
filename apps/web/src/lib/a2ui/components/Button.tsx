import type { ButtonComponent as ButtonComp } from "../a2ui-types";

interface Props {
  comp: ButtonComp;
  resolve: <T>(val: T) => unknown;
  onAction?: (name: string, context: Record<string, unknown>) => void;
  /** Live surface data model — submitted with the action as the form state. */
  dataModel?: Record<string, unknown>;
}

export function ButtonComponent({ comp, resolve, onAction, dataModel }: Props) {
  const label = String(resolve(comp.label) ?? "");
  const variant = (resolve(comp.variant) as ButtonComp["variant"]) ?? "primary";
  const disabled = resolve(comp.disabled) === true;

  function handleClick() {
    if (!comp.action || disabled) return;
    if ("event" in comp.action) {
      // Resolve data-bound context values ({ path: "/x" } → current data
      // model value) instead of leaking raw binding objects to the agent.
      const rawContext = comp.action.event.context ?? {};
      const context = Object.fromEntries(
        Object.entries(rawContext).map(([key, value]) => [key, resolve(value)]),
      );
      // Always attach the live form state: agents routinely omit form
      // bindings from the action context, which silently drops user input
      // (e.g. a device picker submitting the "default" choice).
      if (dataModel && Object.keys(dataModel).length > 0) {
        context.formData = structuredClone(dataModel);
      }
      onAction?.(comp.action.event.name, context);
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
