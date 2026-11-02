export interface Option {
  id: string;
  name: string;
}

export interface GoalDraft {
  subject: string;
  action: string;
  metric: string;
  assigneeKind: string;
  assigneeId: string | null;
  pipelineId: string | null;
  activityTypeId: string | null;
  interval: string;
  target: string;
  currency?: string;
  startsOn: string;
  endsOn: string | null;
}
