export type NextActionQueueScope = "mine" | "all-permitted";

export interface NextActionQueueInput {
  scope: NextActionQueueScope;
  limit: number;
  offset: number;
}

export interface QueueRecordLink {
  id: string;
  label: string;
}

export interface NextActionActivityRow {
  kind: "activity";
  id: string;
  reason: "overdue";
  title: string;
  dueAt: string;
  endAt: string | null;
  allDay: boolean;
  dueDate: string | null;
  endDate: string | null;
  assigneeId: string;
  assigneeName: string;
  deal: QueueRecordLink | null;
  person: QueueRecordLink | null;
  organization: QueueRecordLink | null;
  lead: QueueRecordLink | null;
  // Presentation hints only. Every write still needs current command admission.
  canEdit: boolean;
  canComplete: boolean;
}

export interface NextActionDealRow {
  kind: "deal";
  id: string;
  reason: "missing-next-step";
  title: string;
  ownerId: string;
  ownerName: string;
  pipeline: QueueRecordLink;
  lastActivityAt: string | null;
  createdAt: string;
  person: QueueRecordLink | null;
  organization: QueueRecordLink | null;
  canSchedule: boolean;
}

export type NextActionQueueRow = NextActionActivityRow | NextActionDealRow;

export interface NextActionQueuePage {
  readId: string;
  asOf: string;
  timeZone: string;
  scope: NextActionQueueScope;
  limit: number;
  offset: number;
  total: number;
  counts: { overdue: number; missingNextStep: number };
  rows: NextActionQueueRow[];
}
