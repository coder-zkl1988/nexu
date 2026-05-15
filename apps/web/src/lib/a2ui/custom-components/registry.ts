import type { ComponentType } from "react";
import type { SurfaceManager } from "../a2ui-surface";
import type { A2UIComponent } from "../a2ui-types";
import type { SurfaceState } from "../a2ui-types";

export interface CustomComponentProps {
  comp: A2UIComponent;
  resolve: <T>(val: T) => unknown;
  surface: SurfaceState;
  manager: SurfaceManager;
  onAction?: (name: string, context: Record<string, unknown>) => void;
  children?: React.ReactNode;
}

type CustomComponentRegistry = Map<string, ComponentType<CustomComponentProps>>;

const registries: Map<string, CustomComponentRegistry> = new Map();

export function registerCustomComponent(
  catalogId: string,
  componentType: string,
  component: ComponentType<CustomComponentProps>,
): void {
  let registry = registries.get(catalogId);
  if (!registry) {
    registry = new Map();
    registries.set(catalogId, registry);
  }
  registry.set(componentType, component);
}

export function resolveCustomComponent(
  catalogId: string,
  componentType: string,
): ComponentType<CustomComponentProps> | null {
  return registries.get(catalogId)?.get(componentType) ?? null;
}
