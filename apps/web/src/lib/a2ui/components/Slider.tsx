import { useEffect, useState } from "react";
import { getBindingPath } from "../a2ui-surface";
import type { SliderComponent as SliderComp } from "../a2ui-types";

interface Props {
  comp: SliderComp;
  resolve: <T>(val: T) => unknown;
  write?: (path: string, value: unknown) => void;
}

export function SliderComponent({ comp, resolve, write }: Props) {
  const label = comp.label ? String(resolve(comp.label) ?? "") : undefined;
  const value = (resolve(comp.value) as number) ?? 0;
  const min = (resolve(comp.min) as number) ?? 0;
  const max = (resolve(comp.max) as number) ?? 100;
  // v1.0 `steps` divides the range into N discrete intervals and wins over
  // the legacy `step` size when both are present.
  const step =
    typeof comp.steps === "number" && comp.steps >= 1 && max > min
      ? (max - min) / comp.steps
      : ((resolve(comp.step) as number) ?? 1);

  const bindPath = comp.path ?? getBindingPath(comp.value) ?? `/${comp.id}`;

  const [currentValue, setCurrentValue] = useState(value);
  useEffect(() => setCurrentValue(value), [value]);

  useEffect(() => {
    write?.(bindPath, currentValue);
  }, [bindPath, currentValue, write]);

  return (
    <div className="a2ui-slider">
      {label && (
        <label className="a2ui-slider__label" htmlFor={comp.id}>
          {label}
        </label>
      )}
      <input
        id={comp.id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        onChange={(e) => {
          setCurrentValue(Number(e.target.value));
          write?.(bindPath, Number(e.target.value));
        }}
      />
      <span className="a2ui-slider__value">{currentValue}</span>
    </div>
  );
}
