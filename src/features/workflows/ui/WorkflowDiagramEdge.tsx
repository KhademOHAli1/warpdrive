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
  loopReturn?: boolean;
  onInsert?: (position: NodePosition) => void;
  onDisconnect?: () => void;
}>;

// Standard-edge geometry from the pinned Twenty v2.55.0 visual reference. Workflow graph
// validity and mutations remain owned by graphEditor and the existing palette context.
function edgeGeometry(props: EdgeProps<WorkflowCanvasEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  if (props.data?.spec.port === "loop") {
    const [path, x, y] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 16,
      offset: 40,
    });
    return { paths: [path], overlay: { x, y } };
  }
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
  const x = props.data?.loopReturn === true ? sourceX + 200 : (sourceX + targetX) / 2;
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

const edgeColors = {
  completed: "var(--workflow-success)",
  selected: "var(--workflow-accent)",
  hover: "var(--workflow-light-text)",
  default: "var(--workflow-border-strong)",
};

export function WorkflowDiagramEdge(props: EdgeProps<WorkflowCanvasEdge>) {
  const t = useAppTranslations("workflows");
  const { data, selected, style, interactionWidth = 28, markerEnd } = props;
  const geometry = edgeGeometry(props);
  const hovered = data?.hovered === true;
  const state =
    data?.completed === true
      ? "completed"
      : selected === true
        ? "selected"
        : hovered
          ? "hover"
          : "default";
  const color = edgeColors[state];
  const arrow =
    data?.markerPrefix === undefined ? markerEnd : `url(#${data.markerPrefix}-${state})`;
  const onInsert = data?.onInsert;
  const onDisconnect = data?.onDisconnect;
  const mutable = onInsert !== undefined || onDisconnect !== undefined;
  const labelTransform =
    data?.spec.port.startsWith("branch:") === true
      ? `translate(-50%, -50%) translate(${geometry.overlay.x}px, ${geometry.overlay.y}px)`
      : `${props.sourcePosition === Position.Right ? "translate(10px, -50%)" : "translate(-50%, 10px)"} translate(${props.sourceX}px, ${props.sourceY}px)`;
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
              transform: labelTransform,
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
              {onInsert !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  static
                  className="workflow-edge-action"
                  aria-label={t("insertConnectedStep")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInsert(geometry.overlay);
                  }}
                >
                  <WorkflowReferenceIcon name="plus" size={14} />
                </Button>
              )}
              {onDisconnect !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  static
                  className="workflow-edge-action"
                  aria-label={t("removeConnection")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDisconnect();
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
