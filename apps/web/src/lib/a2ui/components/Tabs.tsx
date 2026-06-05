import { useState } from "react";
import { ComponentNode } from "../a2ui-renderer";
import type { SurfaceManager } from "../a2ui-surface";
import type {
  ChildList,
  ComponentId,
  SurfaceState,
  TabsComponent as TabsComp,
} from "../a2ui-types";

interface Props {
  comp: TabsComp;
  resolve: <T>(val: T) => unknown;
  surface: SurfaceState;
  manager: SurfaceManager;
  onAction?: (name: string, context: Record<string, unknown>) => void;
  children: React.ReactNode;
}

export function TabsComponent({
  comp,
  resolve,
  surface,
  manager,
  onAction,
}: Props) {
  const selectedIndex = (resolve(comp.selectedIndex) as number) ?? 0;
  const [activeTab, setActiveTab] = useState(selectedIndex);

  const tabs = comp.tabs.map((tab, i) => ({
    label: String(resolve(tab.label) ?? ""),
    index: i,
    children: resolveChildIds(tab.children),
  }));

  return (
    <div className="a2ui-tabs">
      <div className="a2ui-tabs__header">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.index}
            className={`a2ui-tabs__tab${tab.index === activeTab ? " a2ui-tabs__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="a2ui-tabs__content">
        {tabs[activeTab]?.children.map((id) => (
          <ComponentNode
            key={id}
            componentId={id}
            surface={surface}
            manager={manager}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );

  function resolveChildIds(childList: ChildList): ComponentId[] {
    if (Array.isArray(childList)) return childList;
    return [];
  }
}
