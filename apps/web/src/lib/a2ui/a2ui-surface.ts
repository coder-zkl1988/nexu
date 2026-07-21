import type {
  A2UIComponent,
  A2UIMessage,
  ComponentId,
  SurfaceState,
} from "./a2ui-types";

export function createSurfaceManager() {
  const surfaces = new Map<string, SurfaceState>();

  function processMessage(msg: A2UIMessage): void {
    if (msg.version !== "v0.9") return;

    if ("createSurface" in msg) {
      const { surfaceId, catalogId, components, dataModel } = msg.createSurface;
      const surface: SurfaceState = {
        surfaceId,
        catalogId:
          catalogId ?? "https://a2ui.org/specification/v0_9/basic_catalog.json",
        components: new Map(),
        dataModel: {},
        rootComponentIds: [],
      };
      surfaces.set(surfaceId, surface);

      // Inline initial state (adopted from A2UI v1.0): a single createSurface
      // can carry the full component tree and data model.
      if (dataModel && typeof dataModel === "object") {
        for (const [key, value] of Object.entries(dataModel)) {
          surface.dataModel[key] = value;
        }
      }
      if (Array.isArray(components)) {
        applyComponents(surface, components);
      }
    } else if ("updateComponents" in msg) {
      const surface = surfaces.get(msg.updateComponents.surfaceId);
      if (!surface) return;

      applyComponents(surface, msg.updateComponents.components);
    } else if ("updateDataModel" in msg) {
      const surface = surfaces.get(msg.updateDataModel.surfaceId);
      if (!surface) return;

      applyDataPath(
        surface.dataModel,
        msg.updateDataModel.path,
        msg.updateDataModel.value,
      );
    } else if ("deleteSurface" in msg) {
      surfaces.delete(msg.deleteSurface.surfaceId);
    }
  }

  function processMessages(messages: A2UIMessage[]): void {
    for (const msg of messages) {
      processMessage(msg);
    }
  }

  function getSurface(surfaceId: string): SurfaceState | undefined {
    return surfaces.get(surfaceId);
  }

  function getAllSurfaces(): Map<string, SurfaceState> {
    return surfaces;
  }

  function resolveValue<T>(
    val:
      | T
      | { path: string }
      | { function: string; args?: Record<string, unknown> },
    dataModel: Record<string, unknown>,
  ): T | string | number | boolean | unknown {
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return val as T;
    if ("path" in val) {
      return getByJsonPointer(dataModel, (val as { path: string }).path);
    }
    if ("function" in val) {
      // Client-side function calls are not evaluated — return undefined
      return undefined;
    }
    return val as T;
  }

  return {
    processMessage,
    processMessages,
    getSurface,
    getAllSurfaces,
    resolveValue,
  };
}

export type SurfaceManager = ReturnType<typeof createSurfaceManager>;

/** Merge a batch of components into a surface and recompute root IDs. */
function applyComponents(
  surface: SurfaceState,
  components: A2UIComponent[],
): void {
  const parentSet = new Set<ComponentId>();
  for (const comp of components) {
    surface.components.set(comp.id, comp);
    parentSet.add(comp.id);
  }

  // Remove any component IDs that appear as children from the root set
  for (const comp of components) {
    const children = getDirectChildren(comp);
    if (Array.isArray(children)) {
      for (const childId of children) {
        parentSet.delete(childId);
      }
    }
  }

  // Collect all child IDs referenced by components in this update
  const childrenInUpdate = new Set<ComponentId>();
  for (const comp of components) {
    const children = getDirectChildren(comp);
    if (Array.isArray(children)) {
      for (const childId of children) {
        childrenInUpdate.add(childId);
      }
    }
  }

  // Merge with existing roots: keep existing roots unless they now have a parent
  for (const id of parentSet) {
    if (!surface.rootComponentIds.includes(id)) {
      surface.rootComponentIds.push(id);
    }
  }
  // Remove roots that are now children of another component in this update
  surface.rootComponentIds = surface.rootComponentIds.filter(
    (id) => parentSet.has(id) || !childrenInUpdate.has(id),
  );
}

function getDirectChildren(comp: A2UIComponent): ComponentId[] | null {
  if ("children" in comp && comp.children) {
    const children = (
      comp as {
        children: ComponentId[] | { componentId: string; path: string };
      }
    ).children;
    if (Array.isArray(children)) return children;
    // Dynamic child list — return empty, resolved at render time
    return null;
  }
  if ("tabs" in comp) {
    const all: ComponentId[] = [];
    for (const tab of (
      comp as {
        tabs: Array<{
          children: ComponentId[] | { componentId: string; path: string };
        }>;
      }
    ).tabs) {
      if (Array.isArray(tab.children)) {
        all.push(...tab.children);
      }
    }
    return all;
  }
  return null;
}

function applyDataPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return;
  let current: Record<string, unknown> = obj;
  for (const key of segments.slice(0, -1)) {
    if (
      !(key in current) ||
      typeof current[key] !== "object" ||
      current[key] === null
    ) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (last === undefined) return;
  if (value === undefined) {
    delete current[last];
  } else {
    current[last] = value;
  }
}

/**
 * Write a value into the surface data model at a JSON-pointer path.
 * Two-way binding write half: form components call this on user input so
 * button actions (and the bot) observe the live form state.
 */
export function setByJsonPointer(
  obj: Record<string, unknown>,
  pointer: string,
  value: unknown,
): void {
  applyDataPath(obj, pointer, value);
}

/**
 * Extract the data-binding path from a dynamic value (`{ path: "/x" }`).
 * Returns null for literals and function bindings.
 */
export function getBindingPath(val: unknown): string | null {
  if (
    val !== null &&
    typeof val === "object" &&
    "path" in val &&
    typeof (val as { path: unknown }).path === "string"
  ) {
    return (val as { path: string }).path;
  }
  return null;
}

export function getByJsonPointer(obj: unknown, pointer: string): unknown {
  if (!pointer || pointer === "/") return obj;
  const segments = pointer.split("/").filter(Boolean);
  let current: unknown = obj;
  for (const seg of segments) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
