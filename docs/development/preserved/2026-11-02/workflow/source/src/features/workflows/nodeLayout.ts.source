import type { NodePosition, WorkflowDefinition, WorkflowEdge } from "./schemas";

const COLUMN_SPACING = 360;
const ROW_SPACING = 260;

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
        ) * ROW_SPACING,
    }
  );
}
export function positionForNewNode(
  graph: WorkflowDefinition,
  selected: string,
  output?: Pick<WorkflowEdge, "from" | "port">,
): NodePosition {
  const origin = positionFor(graph, output?.from ?? selected);
  const previous =
    output === undefined
      ? undefined
      : graph.edges.find((edge) => edge.from === output.from && edge.port === output.port);
  if (previous !== undefined) {
    const target = positionFor(graph, previous.to);
    return clearPosition(graph, { x: (origin.x + target.x) / 2, y: (origin.y + target.y) / 2 });
  }
  const offset =
    output === undefined
      ? COLUMN_SPACING
      : output.port === "true"
        ? -200
        : output.port === "false"
          ? 200
          : 0;
  return { x: origin.x + offset, y: origin.y + ROW_SPACING };
}
export function currentLayout(graph: WorkflowDefinition): Record<string, NodePosition> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, positionFor(graph, node.id)]));
}
function clearPosition(graph: WorkflowDefinition, origin: NodePosition): NodePosition {
  const occupied = Object.values(currentLayout(graph));
  const direction = origin.x > 0 ? -1 : 1;
  const position = { ...origin };
  // Each node blocks at most two columns. Moving toward zero keeps the bounded graph in range.
  while (
    occupied.some(
      (existing) =>
        Math.abs(existing.x - position.x) < COLUMN_SPACING &&
        Math.abs(existing.y - position.y) < ROW_SPACING,
    )
  ) {
    position.x += COLUMN_SPACING * direction;
  }
  return position;
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
    positions.set(id, {
      x: left + ((width(id) - 1) * COLUMN_SPACING) / 2,
      y: depth * ROW_SPACING,
    });
    let nextLeft = left;
    for (const next of children(id)) {
      place(next, nextLeft, depth + 1);
      nextLeft += width(next) * COLUMN_SPACING;
    }
  }
  let left = 0;
  const roots = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.to === node.id));
  for (const node of [...roots, ...graph.nodes]) {
    if (positions.has(node.id)) continue;
    place(node.id, left, 0);
    left += width(node.id) * COLUMN_SPACING + 120;
  }
  return { ...graph, layout: Object.fromEntries(positions) };
}
