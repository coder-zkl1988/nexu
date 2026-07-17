import { useEffect, useState } from "react";
import { getBindingPath } from "../a2ui-surface";
import type { TextFieldComponent as TextFieldComp } from "../a2ui-types";

interface Props {
  comp: TextFieldComp;
  resolve: <T>(val: T) => unknown;
  write?: (path: string, value: unknown) => void;
}

export function TextFieldComponent({ comp, resolve, write }: Props) {
  const label = comp.label ? String(resolve(comp.label) ?? "") : undefined;
  const value = comp.value ? String(resolve(comp.value) ?? "") : "";
  const placeholder = comp.placeholder
    ? String(resolve(comp.placeholder) ?? "")
    : undefined;
  const hint = comp.hint ? String(resolve(comp.hint) ?? "") : undefined;
  const error = comp.error ? String(resolve(comp.error) ?? "") : undefined;
  const multiline = resolve(comp.multiline) === true;
  const required = resolve(comp.required) === true;

  // Two-way binding target: explicit `path`, else the `value` binding, else
  // the component id — button actions submit the live form state.
  const bindPath = comp.path ?? getBindingPath(comp.value) ?? `/${comp.id}`;

  const [currentValue, setCurrentValue] = useState(value);
  useEffect(() => setCurrentValue(value), [value]);

  useEffect(() => {
    write?.(bindPath, currentValue);
  }, [bindPath, currentValue, write]);

  const inputProps = {
    id: comp.id,
    className: `a2ui-textfield${error ? " a2ui-textfield--error" : ""}`,
    placeholder,
    required,
    value: currentValue,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setCurrentValue(e.target.value);
      write?.(bindPath, e.target.value);
    },
  };

  return (
    <div className="a2ui-textfield-wrapper">
      {label && (
        <label className="a2ui-textfield-label" htmlFor={comp.id}>
          {label}
        </label>
      )}
      {multiline ? (
        <textarea {...inputProps} />
      ) : (
        <input type="text" {...inputProps} />
      )}
      {hint && !error && <span className="a2ui-textfield-hint">{hint}</span>}
      {error && <span className="a2ui-textfield-error">{error}</span>}
    </div>
  );
}
