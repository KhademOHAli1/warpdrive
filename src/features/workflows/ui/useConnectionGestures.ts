"use client";

import type { Connection, Edge, OnConnectEnd } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useRef } from "react";
import { drawConnection, type OutputTarget } from "../connectionGestures";
import { type ConnectionProblem, edgeId } from "../graphEditor";
import { portsFor } from "../graphPorts";
import {
  type NodePosition,
  type WorkflowDefinition,
  type WorkflowEdge,
  workflowPortSchema,
} from "../schemas";

function asEdge(connection: Connection | Edge): WorkflowEdge | null {
  const port = workflowPortSchema.safeParse(connection.sourceHandle ?? "next");
  return port.success ? { from: connection.source, to: connection.target, port: port.data } : null;
}
export type AddFromOutput = (output: OutputTarget, position?: NodePosition) => void;

export function useConnectionGestures({
  definition,
  editable,
  onChange,
  onProblem,
  onSelectEdge,
  onAdd,
}: {
  definition: WorkflowDefinition;
  editable: boolean;
  onChange: Dispatch<SetStateAction<WorkflowDefinition>>;
  onProblem: (problem: ConnectionProblem | null) => void;
  onSelectEdge: (id: string | null) => void;
  onAdd?: AddFromOutput;
}) {
  const reconnecting = useRef<WorkflowEdge | undefined>(undefined);
  function isValidConnection(connection: Connection | Edge) {
    const spec = asEdge(connection);
    return editable && spec !== null && drawConnection(definition, spec, reconnecting.current).ok;
  }
  function connect(connection: Connection, previous = reconnecting.current) {
    const spec = asEdge(connection);
    if (!editable || spec === null) return;
    const result = drawConnection(definition, spec, previous);
    if (!result.ok) {
      onProblem(result.error);
      return;
    }
    onChange(result.value);
    onProblem(null);
    onSelectEdge(edgeId(spec));
  }
  const finish: OnConnectEnd = (event, state) => {
    if (!editable || state.isValid === true || state.fromHandle?.type !== "source") return;
    const port = workflowPortSchema.safeParse(state.fromHandle.id);
    const source = definition.nodes.find((node) => node.id === state.fromHandle?.nodeId);
    if (!port.success || source === undefined || !portsFor(source).includes(port.data)) return;
    const output: OutputTarget = { from: source.id, port: port.data };
    const card =
      event.target instanceof Element
        ? event.target.closest(".react-flow__node")?.getAttribute("data-id")
        : null;
    const target = state.toNode?.id ?? card;
    if (target !== null && target !== undefined) {
      if (state.toHandle?.type === "source") {
        onProblem("invalidPort");
        return;
      }
      connect({ source: output.from, sourceHandle: output.port, target, targetHandle: "in" });
      return;
    }
    const pane =
      event.target instanceof Element && event.target.closest(".react-flow__pane") !== null;
    const occupied = definition.edges.some(
      (edge) => edge.from === output.from && edge.port === output.port,
    );
    if (!pane || occupied || reconnecting.current !== undefined || state.to === null) return;
    onProblem(null);
    onAdd?.(output, state.to);
  };
  return {
    startReconnect: (edge: WorkflowEdge | undefined) => {
      reconnecting.current = edge;
      onProblem(null);
    },
    endReconnect: () => {
      reconnecting.current = undefined;
    },
    connect,
    finish,
    isValidConnection,
  };
}
