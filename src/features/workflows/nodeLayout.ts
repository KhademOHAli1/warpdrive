import type { NodePosition, WorkflowDefinition, WorkflowEdge } from "./schemas";

export type NodeMeasurements = ReadonlyMap<string, { width: number; height: number }>;

const COLUMN_SPACING = 360;
const ROW_SPACING = 150;

export function positionFor(graph: WorkflowDefinition, id: string): NodePosition {
  return (
    (graph.layout !== undefined && Object.hasOwn(graph.layout, id)
      ? graph.layout[id]
      : undefined) ?? {
      x: 0,
      anchor: "center",
      y:
        Math.max(
          0,
          graph.nodes.findIndex((node) => node.id === id),
        ) * ROW_SPACING,
    }
  );
}

function placementPosition(
  graph: WorkflowDefinition,
  id: string,
  measurements?: NodeMeasurements,
): NodePosition {
  const position = positionFor(graph, id);
  const dimensions = measurements?.get(id);
  if (
    position.anchor === "center" ||
    dimensions === undefined ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  )
    return position;
  return {
    x: position.x + dimensions.width / 2,
    y: position.y + dimensions.height / 2,
    anchor: "center",
  };
}

function boundedPosition(position: NodePosition): NodePosition {
  return {
    ...position,
    x: Math.max(-100000, Math.min(100000, position.x)),
    y: Math.max(-100000, Math.min(100000, position.y)),
  };
}

export function positionForNewNode(
  graph: WorkflowDefinition,
  selected: string,
  output?: Pick<WorkflowEdge, "from" | "port">,
  measurements?: NodeMeasurements,
): NodePosition {
  const origin = placementPosition(graph, output?.from ?? selected, measurements);
  const previous =
    output === undefined
      ? undefined
      : graph.edges.find((edge) => edge.from === output.from && edge.port === output.port);
  if (previous !== undefined) {
    const target = placementPosition(graph, previous.to, measurements);
    // Never average a known center with an unmeasured legacy top-left coordinate.
    if (origin.anchor === target.anchor)
      return clearPosition(
        graph,
        { ...origin, x: (origin.x + target.x) / 2, y: (origin.y + target.y) / 2 },
        measurements,
      );
  }
  const offset =
    output === undefined
      ? COLUMN_SPACING
      : output.port === "true"
        ? -200
        : output.port === "false"
          ? 200
          : 0;
  const suggested = boundedPosition({ ...origin, x: origin.x + offset, y: origin.y + ROW_SPACING });
  return previous === undefined ? suggested : clearPosition(graph, suggested, measurements);
}
export function currentLayout(graph: WorkflowDefinition): Record<string, NodePosition> {
  return Object.fromEntries(graph.nodes.map((node) => [node.id, positionFor(graph, node.id)]));
}
function clearPosition(
  graph: WorkflowDefinition,
  origin: NodePosition,
  measurements?: NodeMeasurements,
): NodePosition {
  const occupied = graph.nodes.map((node) => placementPosition(graph, node.id, measurements));
  const direction = origin.x > 0 ? -1 : 1;
  const position = boundedPosition(origin);
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
      anchor: "center",
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
