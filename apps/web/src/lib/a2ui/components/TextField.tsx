import { useEffect, useState } from "react";
import type { TextFieldComponent as TextFieldComp } from "../a2ui-types";

interface Props {
  comp: TextFieldComp;
  resolve: <T>(val: T) => unknown;
}

export function TextFieldComponent({ comp, resolve }: Props) {
  const label = comp.label ? String(resolve(comp.label) ?? "") : undefined;
  const value = comp.value ? String(resolve(comp.value) ?? "") : "";
  const placeholder = comp.placeholder
    ? String(resolve(comp.placeholder) ?? "")
    : undefined;
  const hint = comp.hint ? String(resolve(comp.hint) ?? "") : undefined;
  const error = comp.error ? String(resolve(comp.error) ?? "") : undefined;
  const multiline = resolve(comp.multiline) === true;
  const required = resolve(comp.required) === true;

  const [currentValue, setCurrentValue] = useState(value);
  useEffect(() => setCurrentValue(value), [value]);

  const inputProps = {
    id: comp.id,
    className: `a2ui-textfield${error ? " a2ui-textfield--error" : ""}`,
    placeholder,
    required,
    value: currentValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setCurrentValue(e.target.value),
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
