import type { WebContents } from "electron";

/**
 * Agent-facing control of the embedded browser, over the CDP session that
 * `webContents.debugger` exposes in-process.
 *
 * Deliberately not `--remote-debugging-port`: that opens a real TCP listener
 * carrying *every* WebContents in the app — including nexu's own renderer with
 * the user's session — to any local process. A filtering proxy cannot contain
 * that, because anything can reach the port directly. Attaching per view keeps
 * the agent's reach to exactly the view it was given.
 */

/** Roles that carry no interaction or reading value for an agent. */
const SKIPPED_AX_ROLES = new Set([
  "none",
  "presentation",
  "generic",
  "InlineTextBox",
  "LineBreak",
]);

export type BrowserSnapshotNode = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  depth: number;
};

export type BrowserSnapshot = {
  url: string;
  title: string;
  nodes: BrowserSnapshotNode[];
  truncated: boolean;
};

type AxValue = { value?: unknown } | undefined;
type AxProperty = { name?: string; value?: AxValue };
type AxNode = {
  nodeId?: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: AxProperty[];
};

function axText(value: AxValue): string {
  const inner = value?.value;
  return typeof inner === "string"
    ? inner
    : typeof inner === "number" || typeof inner === "boolean"
      ? String(inner)
      : "";
}

function axFlag(node: AxNode, name: string): boolean {
  return (
    node.properties?.some(
      (property) => property.name === name && property.value?.value === true,
    ) ?? false
  );
}

/**
 * Refs are stable for the lifetime of a page and reset only on navigation.
 *
 * They map to `backendDOMNodeId` rather than the AX `nodeId`: AX node ids are
 * only meaningful within the tree that produced them, while backend node ids
 * stay valid for the lifetime of the DOM node.
 *
 * Renumbering per snapshot looks harmless but breaks the thing refs exist for:
 * an agent types into `e12`, snapshots again to check the result, and `e12` is
 * now a different element. Reusing the ref for a node already seen keeps
 * "the element I acted on" addressable across snapshots, which is also what
 * lets a read-back serve as evidence that the action landed.
 */
export class BrowserRefTable {
  private byRef = new Map<string, number>();
  private byNode = new Map<number, string>();
  private counter = 0;

  reset(): void {
    this.byRef.clear();
    this.byNode.clear();
    // The counter deliberately survives: restarting it would let a ref issued
    // before a navigation resolve to whatever element got the same number on
    // the new page. That matters most when two conversations share the tab —
    // one navigates between the other's snapshot and click, and the stale ref
    // would act on an element the agent never saw. Never reusing ids turns
    // that into a clean "unknown element ref" instead.
  }

  add(backendNodeId: number): string {
    const existing = this.byNode.get(backendNodeId);
    if (existing) return existing;
    this.counter += 1;
    const ref = `e${this.counter}`;
    this.byRef.set(ref, backendNodeId);
    this.byNode.set(backendNodeId, ref);
    return ref;
  }

  resolve(ref: string): number | null {
    return this.byRef.get(ref) ?? null;
  }
}

async function send<T>(
  contents: WebContents,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!contents.debugger.isAttached()) {
    contents.debugger.attach("1.3");
  }
  return (await contents.debugger.sendCommand(method, params ?? {})) as T;
}

export function detachDebugger(contents: WebContents): void {
  try {
    if (contents.debugger.isAttached()) contents.debugger.detach();
  } catch {
    // Detaching a destroyed view is not an error worth surfacing.
  }
}

export async function captureSnapshot(
  contents: WebContents,
  refs: BrowserRefTable,
  maxNodes: number,
): Promise<BrowserSnapshot> {
  const tree = await send<{ nodes?: AxNode[] }>(
    contents,
    "Accessibility.getFullAXTree",
  );
  // Refs deliberately survive a snapshot; only navigation clears them.

  const all = tree.nodes ?? [];
  const byId = new Map<string, AxNode>();
  for (const node of all) {
    if (node.nodeId) byId.set(node.nodeId, node);
  }

  // Depth conveys structure to the agent without shipping the whole tree.
  const depthOf = (node: AxNode): number => {
    let depth = 0;
    let current = node;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      depth += 1;
      current = parent;
      if (depth > 64) break;
    }
    return depth;
  };

  const nodes: BrowserSnapshotNode[] = [];
  let truncated = false;
  for (const node of all) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      break;
    }
    if (node.ignored || typeof node.backendDOMNodeId !== "number") continue;
    const role = axText(node.role);
    if (!role || SKIPPED_AX_ROLES.has(role)) continue;
    const name = axText(node.name);
    const value = axText(node.value);
    // A node with neither a name nor a value is not addressable by an agent
    // and only adds noise.
    if (!name && !value) continue;

    nodes.push({
      ref: refs.add(node.backendDOMNodeId),
      role,
      name,
      ...(value ? { value } : {}),
      ...(axFlag(node, "disabled") ? { disabled: true } : {}),
      depth: depthOf(node),
    });
  }

  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    nodes,
    truncated,
  };
}

async function centerOf(
  contents: WebContents,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  const box = await send<{ model?: { content?: number[] } }>(
    contents,
    "DOM.getBoxModel",
    { backendNodeId },
  );
  const quad = box.model?.content;
  if (!quad || quad.length < 8) {
    throw new Error("element has no layout box; it may be hidden");
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]].filter(
    (value): value is number => typeof value === "number",
  );
  const ys = [quad[1], quad[3], quad[5], quad[7]].filter(
    (value): value is number => typeof value === "number",
  );
  return {
    x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
    y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
  };
}

export async function clickRef(
  contents: WebContents,
  refs: BrowserRefTable,
  ref: string,
): Promise<void> {
  const backendNodeId = refs.resolve(ref);
  if (backendNodeId === null) {
    throw new Error(`unknown element ref ${ref}; take a snapshot first`);
  }
  await send(contents, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(
    () => undefined,
  );
  const point = await centerOf(contents, backendNodeId);
  for (const type of ["mousePressed", "mouseReleased"] as const) {
    await send(contents, "Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: "left",
      // The bitmask of buttons held *during* the event, which CDP treats
      // separately from `button`. Omitting it sends a press that claims no
      // button is down.
      buttons: type === "mousePressed" ? 1 : 0,
      clickCount: 1,
    });
  }
}

export async function typeIntoRef(
  contents: WebContents,
  refs: BrowserRefTable,
  ref: string,
  text: string,
  submit = false,
): Promise<void> {
  const backendNodeId = refs.resolve(ref);
  if (backendNodeId === null) {
    throw new Error(`unknown element ref ${ref}; take a snapshot first`);
  }
  await send(contents, "DOM.focus", { backendNodeId });
  await send(contents, "Input.insertText", { text });
  if (!submit) return;
  // `Input.insertText` never produces key events, so a search box that submits
  // on Enter would sit there filled in and unsubmitted. Enter is dispatched as
  // real key events for exactly that reason.
  for (const type of ["keyDown", "keyUp"] as const) {
    await send(contents, "Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: type === "keyDown" ? "\r" : undefined,
    });
  }
}

export async function scrollBy(
  contents: WebContents,
  deltaY: number,
): Promise<void> {
  const metrics = await send<{
    cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
  }>(contents, "Page.getLayoutMetrics");
  const viewport = metrics.cssLayoutViewport;
  await send(contents, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.round((viewport?.clientWidth ?? 800) / 2),
    y: Math.round((viewport?.clientHeight ?? 600) / 2),
    deltaX: 0,
    deltaY,
  });
}
