import type { Result } from "@/types/result";

export interface PipelineLifecycleInput {
  pipelineId: string;
  expectedUpdatedAt: string;
}

export type PipelineLifecycleError =
  | "conflict"
  | "denied"
  | "failed"
  | "unavailable"
  | "last-active"
  | "default-pipeline"
  | "fresh-auth-required";

export type PipelineLifecycleResult = Result<{ updatedAt: string }, PipelineLifecycleError>;

export interface PipelineDirectoryData {
  id: string;
  name: string;
  isArchived: boolean;
  updatedAt: string;
  stageCount: number;
  dealCount: number;
  visibility: "workspace" | "restricted";
}
