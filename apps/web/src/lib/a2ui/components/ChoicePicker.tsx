import { useEffect, useState } from "react";
import type { ChoicePickerComponent as ChoicePickerComp } from "../a2ui-types";

interface Props {
  comp: ChoicePickerComp;
  resolve: <T>(val: T) => unknown;
}

export function ChoicePickerComponent({ comp, resolve }: Props) {
  const label = comp.label ? String(resolve(comp.label) ?? "") : undefined;
  const selected = comp.selected
    ? String(resolve(comp.selected) ?? "")
    : undefined;
  const choices = comp.choices.map((c) => ({
    label: String(resolve(c.label) ?? ""),
    value: c.value,
  }));

  const [currentValue, setCurrentValue] = useState(selected ?? "");
  useEffect(() => {
    if (selected !== undefined) setCurrentValue(selected);
  }, [selected]);

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
        onChange={(e) => setCurrentValue(e.target.value)}
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
