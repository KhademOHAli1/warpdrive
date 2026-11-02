import { vi } from "vitest";
import type { NextActionQueueProps } from "./NextActionQueue";
import type {
  NextActionActivityRow,
  NextActionDealRow,
  NextActionQueuePage,
} from "./next-action-queue/queueTypes";

export function activityRow(): NextActionActivityRow {
  return {
    kind: "activity",
    id: "activity-1",
    reason: "overdue",
    title: "پیگیری / Follow-up",
    dueAt: "2026-10-31T10:00:00Z",
    endAt: null,
    allDay: false,
    dueDate: null,
    endDate: null,
    assigneeId: "user-1",
    assigneeName: "بیان / Bianca",
    deal: { id: "linked-deal", label: "فرصت / Chance" },
    person: null,
    organization: null,
    lead: null,
    canEdit: true,
    canComplete: true,
  };
}
export function dealRow(): NextActionDealRow {
  return {
    kind: "deal",
    id: "deal-1",
    reason: "missing-next-step",
    title: "پیشنهاد / Angebot",
    ownerId: "user-1",
    ownerName: "بیان / Bianca",
    pipeline: { id: "pipeline-1", label: "Vertrieb / فروش" },
    lastActivityAt: null,
    createdAt: "2026-10-01T10:00:00Z",
    person: null,
    organization: null,
    canSchedule: true,
  };
}
export function queuePage(): NextActionQueuePage {
  return {
    readId: "read-1",
    asOf: "2026-11-01T10:00:00Z",
    timeZone: "Europe/Berlin",
    scope: "mine",
    limit: 25,
    offset: 0,
    total: 2,
    counts: { overdue: 1, missingNextStep: 1 },
    rows: [activityRow(), dealRow()],
  };
}
export function queueProps(): NextActionQueueProps & { page: NextActionQueuePage } {
  return {
    input: { scope: "mine", limit: 25, offset: 0 },
    page: queuePage(),
    loading: false,
    error: false,
    onScopeChange: vi.fn(),
    onPageChange: vi.fn(),
    onRefresh: vi.fn(),
    onEditActivity: vi.fn(),
    onScheduleDeal: vi.fn(),
  };
}
