import { useEffect, useState } from "react";
import type { CheckBoxComponent as CheckBoxComp } from "../a2ui-types";

interface Props {
  comp: CheckBoxComp;
  resolve: <T>(val: T) => unknown;
}

export function CheckBoxComponent({ comp, resolve }: Props) {
  const label = String(resolve(comp.label) ?? "");
  const checked = resolve(comp.checked) === true;

  const [isChecked, setIsChecked] = useState(checked);
  useEffect(() => setIsChecked(checked), [checked]);

  return (
    <label className="a2ui-checkbox">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={(e) => setIsChecked(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
