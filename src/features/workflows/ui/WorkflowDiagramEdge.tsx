"use client";

import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  Position,
} from "@xyflow/react";
import { Button } from "@/components/ui/Button";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { NodePosition, WorkflowEdge } from "../schemas";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";

export type WorkflowCanvasEdge = Edge<{
  spec: WorkflowEdge;
  markerPrefix?: string;
  hovered?: boolean;
  completed?: boolean;
  onInsert?: (position: NodePosition) => void;
  onDisconnect?: () => void;
}>;

// Standard-edge geometry from the pinned Twenty v2.55.0 visual reference. Workflow graph
// validity and mutations remain owned by graphEditor and the existing palette context.
function edgeGeometry(props: EdgeProps<WorkflowCanvasEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  if (sourceY < targetY) {
    const [path, x, y] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    return { paths: [path], overlay: { x, y } };
  }
  const x = (sourceX + targetX) / 2;
  const y = sourceY + 40;
  const [first] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX: x,
    targetY: y,
    sourcePosition,
    targetPosition: Position.Bottom,
    borderRadius: 16,
    offset: 40,
  });
  const [second] = getSmoothStepPath({
    sourceX: x,
    sourceY: y,
    targetX,
    targetY,
    sourcePosition: Position.Top,
    targetPosition,
    borderRadius: 16,
    offset: 40,
  });
  return { paths: [first, second], overlay: { x, y } };
}

export function WorkflowDiagramEdge(props: EdgeProps<WorkflowCanvasEdge>) {
  const t = useAppTranslations("workflows");
  const { data, selected, style, interactionWidth = 28, markerEnd } = props;
  const geometry = edgeGeometry(props);
  const hovered = data?.hovered === true;
  const state =
    data?.completed === true ? "completed" : selected ? "selected" : hovered ? "hover" : "default";
  const color =
    state === "completed"
      ? "var(--workflow-success)"
      : state === "selected"
        ? "var(--workflow-accent)"
        : state === "hover"
          ? "var(--workflow-light-text)"
          : "var(--workflow-border-strong)";
  const arrow =
    data?.markerPrefix === undefined ? markerEnd : `url(#${data.markerPrefix}-${state})`;
  const mutable = data?.onInsert !== undefined || data?.onDisconnect !== undefined;
  return (
    <>
      {geometry.paths.map((path, index) => (
        <BaseEdge
          key={path}
          path={path}
          style={{ ...style, stroke: color }}
          markerEnd={index === geometry.paths.length - 1 ? arrow : undefined}
          interactionWidth={interactionWidth}
        />
      ))}
      <EdgeLabelRenderer>
        {props.label !== undefined && (
          <span
            className="workflow-edge-label"
            style={{
              transform: `${props.sourcePosition === Position.Right ? "translate(10px, -50%)" : "translate(-50%, 10px)"} translate(${props.sourceX}px, ${props.sourceY}px)`,
            }}
          >
            {props.label}
          </span>
        )}
        {mutable && (
          <div
            className="workflow-edge-controls nodrag nopan"
            data-visible={hovered}
            style={{
              transform: `translate(-50%, -50%) translate(${geometry.overlay.x}px, ${geometry.overlay.y}px)`,
            }}
          >
            <fieldset aria-label={t("connections")} className="workflow-edge-control-group">
              {data?.onInsert !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  static
                  className="workflow-edge-action"
                  aria-label={t("insertConnectedStep")}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onInsert?.(geometry.overlay);
                  }}
                >
                  <WorkflowReferenceIcon name="plus" size={14} />
                </Button>
              )}
              {data?.onDisconnect !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  static
                  className="workflow-edge-action"
                  aria-label={t("removeConnection")}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onDisconnect?.();
                  }}
                >
                  <WorkflowReferenceIcon name="trash" size={14} />
                </Button>
              )}
            </fieldset>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
