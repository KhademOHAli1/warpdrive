import type { ERROR_IDS } from "@/constants/errorIds";
import type { WorkflowEdge } from "./schemas";

export const draftSimulationNodeTypes = [
  "trigger.manual",
  "record.read",
  "record.create",
  "record.update",
  "record.delete",
  "record.search",
  "record.pick",
  "email.draft",
  "calendar.create",
  "activity.create",
  "condition",
  "ifElse",
  "filter",
  "delay",
] as const;

export type DraftSimulationNodeType = (typeof draftSimulationNodeTypes)[number];
export type DraftSimulationErrorId = (typeof ERROR_IDS)[keyof typeof ERROR_IDS];

export interface DraftSimulationStep {
  nodeId: string;
  nodeType: DraftSimulationNodeType;
  status: "succeeded" | "failed";
  errorId?: DraftSimulationErrorId;
  port?: WorkflowEdge["port"];
  waitResumeAt?: string;
  recordDeleted?: true;
}

// This is a transient draft receipt, not an ordinary persisted run-detail DTO.
// It deliberately omits CRM outputs, actor/record IDs, rolled-back activity IDs,
// publication numbers and persisted run/step identities.
export interface DraftSimulationReceipt {
  source: "draft";
  mode: "simulation";
  workflowId: string;
  definitionDigest: string;
  testedAt: string;
  outcome: "completed" | "failed";
  steps: DraftSimulationStep[];
}
