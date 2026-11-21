import type { ProjectPerson, ProjectPriority, ProjectWorkflowState } from "../contracts";

export const projectIntakeStatuses = [
  "pending",
  "snoozed",
  "accepted",
  "declined",
  "duplicate",
] as const;
export type ProjectIntakeStatus = (typeof projectIntakeStatuses)[number];
export type ProjectIntakeFilter = ProjectIntakeStatus | "all";

export type ProjectIntakeRequest = {
  id: string;
  title: string;
  description: string;
  priority: ProjectPriority;
  requester: ProjectPerson;
  status: ProjectIntakeStatus;
  revision: number;
  createdAt: string;
  reviewedAt: string | null;
  snoozedUntil: string | null;
  workItemId: string | null;
  canEdit: boolean;
};

export type ProjectIntakeSummary = Omit<ProjectIntakeRequest, "description" | "canEdit">;
export type ProjectIntakeWorkItem = { id: string; title: string; identifier: string };
export type ProjectIntakeWorkspace = {
  enabled: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canManageSettings: boolean;
  requests: ProjectIntakeSummary[];
  selected: ProjectIntakeRequest | null;
  states: ProjectWorkflowState[];
  nextPage: number | null;
};
