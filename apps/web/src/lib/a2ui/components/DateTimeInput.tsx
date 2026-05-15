import { useEffect, useState } from "react";
import type { DateTimeInputComponent as DateTimeComp } from "../a2ui-types";

interface Props {
  comp: DateTimeComp;
  resolve: <T>(val: T) => unknown;
}

export function DateTimeInputComponent({ comp, resolve }: Props) {
  const label = comp.label ? String(resolve(comp.label) ?? "") : undefined;
  const value = comp.value ? String(resolve(comp.value) ?? "") : "";
  const mode = (resolve(comp.mode) as DateTimeComp["mode"]) ?? "date";

  const [currentValue, setCurrentValue] = useState(value);
  useEffect(() => setCurrentValue(value), [value]);

  const inputType =
    mode === "time" ? "time" : mode === "datetime" ? "datetime-local" : "date";

  return (
    <div className="a2ui-datetime-wrapper">
      {label && (
        <label className="a2ui-datetime-label" htmlFor={comp.id}>
          {label}
        </label>
      )}
      <input
        id={comp.id}
        className="a2ui-datetime"
        type={inputType}
        value={currentValue}
        onChange={(e) => setCurrentValue(e.target.value)}
      />
    </div>
  );
}
