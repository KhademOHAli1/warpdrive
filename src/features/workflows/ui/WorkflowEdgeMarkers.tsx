"use client";

import { type ConnectionLineComponentProps, getBezierPath } from "@xyflow/react";

// Twenty v2.55.0 WorkflowDiagramCustomMarkers: the reference is a hollow downward arrow.
const ARROW_PATH =
  "M1.7915 1.38672H8.18311C8.57541 1.38705 8.81458 1.81852 8.60693 2.15137L5.41064 7.26465C5.21481 7.57798 4.75882 7.57798 4.56299 7.26465L1.3667 2.15137C1.15906 1.81841 1.39896 1.38672 1.7915 1.38672Z";
const MARKERS = [
  ["default", "var(--workflow-border-strong)"],
  ["hover", "var(--workflow-light-text)"],
  ["selected", "var(--workflow-accent)"],
  ["completed", "var(--workflow-success)"],
] as const;

export function WorkflowEdgeMarkers({ prefix }: { prefix: string }) {
  return (
    <svg className="workflow-edge-markers" aria-hidden="true" focusable="false">
      <defs>
        {MARKERS.map(([state, stroke]) => (
          <marker
            key={state}
            id={`${prefix}-${state}`}
            markerHeight={8}
            markerWidth={10}
            refX={5}
            refY={4}
          >
            <path d={ARROW_PATH} stroke={stroke} fill="var(--workflow-canvas-surface)" />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export function WorkflowConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY + 4,
    targetX: toX,
    targetY: toY - 4,
  });
  return (
    <path className="react-flow__connection-path workflow-connection-path" d={path} fill="none" />
  );
}
