import type { Result } from "@/types/result";
import type {
  ProjectReadModel,
  ProjectReceipt,
  ProjectStartInput,
} from "./persistence/projectRepositoryTypes";

export type ProjectWorkspaceDraft = {
  contextKey: string;
  input: ProjectStartInput;
  attempt: ProjectStartInput | null;
};

/**
 * rejected, unavailable and conflict affirm that this intent did not commit, including any
 * earlier attempt. A privacy-generic repository project_unavailable does not establish this:
 * the client transport must retain unknown recovery until it has affirmative noncommit proof.
 */
export type ProjectStartOutcome = Result<
  ProjectReceipt,
  "unknown" | "rejected" | "unavailable" | "conflict"
>;

// Client-parent composition only. Each callback must reauthenticate and authorize on the server.
// Checking a retained request must never grant permission to perform an unauthorized fresh write.
export type ProjectWorkspaceSummaryProps = {
  contextKey: string;
  draft: ProjectWorkspaceDraft;
  project: ProjectReadModel | null;
  ownerLabel: string | null;
  contextLabel: string | null;
  canRead: boolean;
  canStart: boolean;
  onDraftChange: (draft: ProjectWorkspaceDraft) => void;
  start: (input: ProjectStartInput, signal: AbortSignal) => Promise<ProjectStartOutcome>;
  refresh: (signal: AbortSignal) => Promise<Result<void, "unavailable">>;
  onStarted: (receipt: ProjectReceipt) => void;
};
