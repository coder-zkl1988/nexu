import { useEffect, useState } from "react";
import { getBindingPath } from "../a2ui-surface";
import type { ChoicePickerComponent as ChoicePickerComp } from "../a2ui-types";

interface Props {
  comp: ChoicePickerComp;
  resolve: <T>(val: T) => unknown;
  write?: (path: string, value: unknown) => void;
}

export function ChoicePickerComponent({ comp, resolve, write }: Props) {
  const label = comp.label ? String(resolve(comp.label) ?? "") : undefined;
  const selected = comp.selected
    ? String(resolve(comp.selected) ?? "")
    : undefined;
  const choices = comp.choices.map((c) => ({
    label: String(resolve(c.label) ?? ""),
    value: c.value,
  }));

  // Two-way binding target: explicit `path`, else the `selected` binding,
  // else fall back to the component id so the value is never lost.
  const bindPath = comp.path ?? getBindingPath(comp.selected) ?? `/${comp.id}`;

  const [currentValue, setCurrentValue] = useState(selected ?? "");
  useEffect(() => {
    if (selected !== undefined) setCurrentValue(selected);
  }, [selected]);

  // Persist the effective value (initial default included) into the data
  // model so a button action submits what the user actually sees.
  useEffect(() => {
    write?.(bindPath, currentValue);
  }, [bindPath, currentValue, write]);

  return (
    <div className="a2ui-choice-picker">
      {label && (
        <label className="a2ui-choice-picker__label" htmlFor={comp.id}>
          {label}
        </label>
      )}
      <select
        id={comp.id}
        className="a2ui-choice-picker__select"
        value={currentValue}
        onChange={(e) => {
          setCurrentValue(e.target.value);
          write?.(bindPath, e.target.value);
        }}
      >
        <option value="">—</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
