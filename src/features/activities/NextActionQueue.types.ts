import type { Result } from "@/types/result";
import type {
  NextActionActivityRow,
  NextActionDealRow,
  NextActionQueueInput,
  NextActionQueuePage,
  NextActionQueueScope,
} from "./next-action-queue/queueTypes";

export type QueueCompletionResult = Result<{ id: string }, { id: string }>;
export interface NextActionQueueProps {
  input: NextActionQueueInput;
  page: NextActionQueuePage | null;
  loading: boolean;
  error: boolean;
  onScopeChange: (scope: NextActionQueueScope) => void;
  onPageChange: (offset: number) => void;
  onRefresh: () => void;
  onEditActivity: (row: NextActionActivityRow) => void;
  onScheduleDeal: (row: NextActionDealRow) => void;
  onCompleteActivity?: (input: { id: string; done: true }) => Promise<QueueCompletionResult>;
}

export type QueueCompletionKind = "pending" | "saved" | "denied" | "failed" | "unconfirmed";
export interface QueueCompletionState {
  kind: QueueCompletionKind;
  readId: string;
}
