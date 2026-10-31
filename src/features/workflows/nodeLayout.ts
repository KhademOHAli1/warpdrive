import type { NodePosition, WorkflowDefinition } from "./schemas";

export function positionFor(graph: WorkflowDefinition, id: string): NodePosition {
  return (
    (graph.layout !== undefined && Object.hasOwn(graph.layout, id)
      ? graph.layout[id]
      : undefined) ?? {
      x: 0,
      y:
        Math.max(
          0,
          graph.nodes.findIndex((node) => node.id === id),
        ) * 180,
    }
  );
}
export function currentLayout(graph: WorkflowDefinition): Record<string, NodePosition> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, positionFor(graph, node.id)]));
}
export function arrangeGraph(graph: WorkflowDefinition): WorkflowDefinition {
  const widths = new Map<string, number>();
  const positions = new Map<string, NodePosition>();
  const children = (id: string) =>
    graph.edges
      .filter((edge) => edge.from === id)
      .sort((a, b) => Number(a.port === "false") - Number(b.port === "false"))
      .map((edge) => edge.to);
  function width(id: string, active = new Set<string>()): number {
    if (active.has(id)) return 1;
    const cached = widths.get(id);
    if (cached !== undefined) return cached;
    const branch = new Set([...active, id]);
    const value = Math.max(
      1,
      children(id).reduce((sum, next) => sum + width(next, branch), 0),
    );
    widths.set(id, value);
    return value;
  }
  function place(id: string, left: number, depth: number) {
    if (positions.has(id)) return;
    positions.set(id, { x: left + ((width(id) - 1) * 360) / 2, y: depth * 180 });
    let nextLeft = left;
    for (const next of children(id)) {
      place(next, nextLeft, depth + 1);
      nextLeft += width(next) * 360;
    }
  }
  let left = 0;
  const roots = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.to === node.id));
  for (const node of [...roots, ...graph.nodes]) {
    if (positions.has(node.id)) continue;
    place(node.id, left, 0);
    left += width(node.id) * 360 + 120;
  }
  return { ...graph, layout: Object.fromEntries(positions) };
}
