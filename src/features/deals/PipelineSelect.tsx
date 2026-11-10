"use client";

import type { ReactNode } from "react";
import { DashboardSelect } from "@/features/dashboards/DashboardSelect";
import type { PipelineDashboardView } from "@/features/dashboards/dashboardViews";

interface PipelineSelectProps {
  pipelineId: string;
  pipelines: Array<{ id: string; name: string }>;
  canManagePipelines?: boolean;
  activeView?: PipelineDashboardView;
}

// Retain the pipeline-toolbar API while both pipelines and Performance share one selector.
export function PipelineSelect({
  pipelineId,
  activeView,
  ...props
}: PipelineSelectProps): ReactNode {
  return (
    <DashboardSelect
      current={{ kind: "pipeline", pipelineId }}
      pipelineView={activeView}
      {...props}
    />
  );
}
