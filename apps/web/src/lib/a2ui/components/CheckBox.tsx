import { useEffect, useState } from "react";
import { getBindingPath } from "../a2ui-surface";
import type { CheckBoxComponent as CheckBoxComp } from "../a2ui-types";

interface Props {
  comp: CheckBoxComp;
  resolve: <T>(val: T) => unknown;
  write?: (path: string, value: unknown) => void;
}

export function CheckBoxComponent({ comp, resolve, write }: Props) {
  const label = String(resolve(comp.label) ?? "");
  const checked = resolve(comp.checked) === true;

  const bindPath = comp.path ?? getBindingPath(comp.checked) ?? `/${comp.id}`;

  const [isChecked, setIsChecked] = useState(checked);
  useEffect(() => setIsChecked(checked), [checked]);

  useEffect(() => {
    write?.(bindPath, isChecked);
  }, [bindPath, isChecked, write]);

  return (
    <label className="a2ui-checkbox">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={(e) => {
          setIsChecked(e.target.checked);
          write?.(bindPath, e.target.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}
