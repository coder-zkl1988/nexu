import type {
  RuntimeApproval,
  RuntimeTask,
  TaskGraph,
  TaskGraphNode,
} from "./types";

export const TASK_GRAPH_PREVIEW_LIMIT = 16;

export function approvalLabelKey(category: RuntimeApproval["category"]) {
  switch (category) {
    case "controlled-terminal":
      return "sessions.operations.controlledTerminal";
    case "browser":
      return "sessions.operations.browserApproval";
    case "computer-use":
      return "sessions.operations.computerUseApproval";
    case "sensitive-tool":
      return "sessions.operations.sensitiveToolApproval";
  }
}

export function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value,
  );
}

export function formatReset(resetAt: number | undefined) {
  if (!resetAt) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(resetAt));
}

export function timestampToMs(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function taskTone(lifecycle: TaskGraphNode["lifecycle"]) {
  if (lifecycle === "running") return "text-[var(--color-brand-primary)]";
  if (
    lifecycle === "failed" ||
    lifecycle === "timed_out" ||
    lifecycle === "blocked"
  ) {
    return "text-danger";
  }
  if (lifecycle === "succeeded") return "text-[var(--color-success)]";
  return "text-text-muted";
}

// The run tab renders these and the tab bar counts them, so the predicate lives
// in one place instead of being restated per caller.
export function selectActiveTasks(tasks: RuntimeTask[]) {
  return tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  );
}

export function orderTaskGraph(graph: TaskGraph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentsById = new Map<string, TaskGraphNode[]>();
  for (const edge of graph.edges) {
    const parent = byId.get(edge.from);
    if (!parent || !byId.has(edge.to)) continue;
    const parents = parentsById.get(edge.to) ?? [];
    parents.push(parent);
    parentsById.set(edge.to, parents);
  }
  const depthById = new Map<string, number>();

  const resolveDepth = (node: TaskGraphNode, trail: Set<string>): number => {
    const cached = depthById.get(node.id);
    if (cached !== undefined) return cached;
    if (trail.has(node.id)) return 0;
    const nextTrail = new Set(trail).add(node.id);
    const parents = parentsById.get(node.id) ?? [];
    const depth =
      parents.length === 0
        ? 0
        : 1 +
          Math.max(...parents.map((parent) => resolveDepth(parent, nextTrail)));
    depthById.set(node.id, depth);
    return depth;
  };

  return graph.nodes
    .map((node) => ({
      node,
      depth: resolveDepth(node, new Set()),
      parents: parentsById.get(node.id) ?? [],
    }))
    .sort(
      (left, right) =>
        left.depth - right.depth ||
        left.node.title.localeCompare(right.node.title),
    );
}
