"use client";

import type { Connection, Edge, OnConnectEnd, ReactFlowInstance } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useRef } from "react";
import { drawConnection, type OutputTarget } from "../connectionGestures";
import { type ConnectionProblem, edgeId } from "../graphEditor";
import type { NodePosition, WorkflowDefinition, WorkflowEdge } from "../schemas";

function asEdge(connection: Connection | Edge): WorkflowEdge | null {
  const port = connection.sourceHandle ?? "next";
  if (!["next", "true", "false"].includes(port)) return null;
  return { from: connection.source, to: connection.target, port: port as WorkflowEdge["port"] };
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
  const viewport = useRef<Pick<ReactFlowInstance, "screenToFlowPosition"> | null>(null);
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
    const port = state.fromHandle.id;
    if (port !== "next" && port !== "true" && port !== "false") return;
    const output: OutputTarget = { from: state.fromHandle.nodeId, port };
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
    if (!pane || occupied || reconnecting.current !== undefined) return;
    const pointer = "changedTouches" in event ? event.changedTouches[0] : event;
    if (pointer === undefined || viewport.current === null) return;
    const position = viewport.current.screenToFlowPosition({
      x: pointer.clientX,
      y: pointer.clientY,
    });
    onProblem(null);
    onAdd?.(output, position);
  };
  return {
    initialize: (instance: Pick<ReactFlowInstance, "screenToFlowPosition">) => {
      viewport.current = instance;
    },
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
