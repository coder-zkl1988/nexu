import type { ModalComponent as ModalComp } from "../a2ui-types";

interface Props {
  comp: ModalComp;
  resolve: <T>(val: T) => unknown;
  children: React.ReactNode;
}

export function ModalComponent({ comp, resolve, children }: Props) {
  const open = resolve(comp.open) === true;
  const title = comp.title ? String(resolve(comp.title) ?? "") : undefined;

  if (!open) return null;

  return (
    <div className="a2ui-modal-overlay">
      <div className="a2ui-modal">
        {title && <div className="a2ui-modal__title">{title}</div>}
        <div className="a2ui-modal__content">{children}</div>
      </div>
    </div>
  );
}
