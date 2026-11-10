import { portsFor } from "../graphPorts";
import type { WorkflowDefinition } from "../schemas";
import { compileWorkflowIteratorGraph } from "../workflowIteratorGraph";
import type { WorkflowCanvasEdge } from "./WorkflowDiagramEdge";

export function iteratorReturnEdges(
  definition: WorkflowDefinition,
  markerPrefix: string,
): WorkflowCanvasEdge[] {
  const iterator = definition.nodes.find((node) => node.type === "iterator");
  if (iterator === undefined) return [];
  const loop = compileWorkflowIteratorGraph(definition, iterator.id);
  if (!loop.ok) return [];
  const terminals = new Set(
    loop.value.body.filter((step) => step.nextNodeIds.length === 0).map((step) => step.id),
  );
  return definition.nodes.flatMap((step) => {
    if (!terminals.has(step.id)) return [];
    const port = portsFor(step)[0];
    if (port === undefined) return [];
    return [
      {
        id: `iterator-return:${step.id}:${iterator.id}`,
        source: step.id,
        target: iterator.id,
        sourceHandle: port,
        targetHandle: "in",
        type: "workflow",
        focusable: false,
        selectable: false,
        deletable: false,
        reconnectable: false,
        interactionWidth: 0,
        data: {
          spec: { from: step.id, to: iterator.id, port },
          markerPrefix,
          loopReturn: true,
        },
      } satisfies WorkflowCanvasEdge,
    ];
  });
}
