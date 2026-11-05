import type { OutputTarget } from "../connectionGestures";
import { portsFor } from "../graphEditor";
import { type NodeMeasurements, positionForNewNode } from "../nodeLayout";
import type { NodePosition, WorkflowDefinition } from "../schemas";

// The draft graph schema cannot admit these ephemeral diagram IDs.
export const pendingStepId = "@pending-step";
export const pendingEdgeId = "@pending-edge";

export type PendingInsertion = { output?: OutputTarget; position?: NodePosition };

export function pendingInsertionPosition(
  definition: WorkflowDefinition,
  pending: PendingInsertion,
  selected: string,
  measurements: NodeMeasurements,
): NodePosition | null {
  if (pending.output !== undefined) {
    const { from, port } = pending.output;
    const source = definition.nodes.find((node) => node.id === from);
    if (source === undefined || !portsFor(source).includes(port)) return null;
    // Insertion between existing steps retains its original connection until a block is chosen.
    if (definition.edges.some((edge) => edge.from === from && edge.port === port)) return null;
  }
  const origin = selected || definition.nodes[0]?.id || "start";
  const position =
    pending.position ?? positionForNewNode(definition, origin, pending.output, measurements);
  return Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Math.abs(position.x) <= 100000 &&
    Math.abs(position.y) <= 100000
    ? position
    : null;
}
