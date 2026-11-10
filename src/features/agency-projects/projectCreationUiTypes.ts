import type { ProjectCreateInput } from "./projectCreationInput";

export type ProjectCreationAttempt = {
  payload: Readonly<ProjectCreateInput>;
  rawInput: Readonly<ProjectCreateInput>;
};

export type ProjectCreationDraft = {
  contextKey: string;
  input: ProjectCreateInput;
  attempt: ProjectCreationAttempt | null;
};

export type ProjectCreationOutcome =
  | { ok: true; value: { projectId: string } }
  | { ok: false; error: "rejected" | "unavailable" | "unknown" };

// Client composition only. The callback must reauthenticate and authorize on the server.
export type ProjectCreationFormProps = {
  contextKey: string;
  draft: ProjectCreationDraft;
  owners: ReadonlyArray<{ id: string; label: string }>;
  contextLabel: string | null;
  canCreate: boolean;
  onDraftChange: (draft: ProjectCreationDraft) => void;
  submit: (input: ProjectCreateInput, signal: AbortSignal) => Promise<ProjectCreationOutcome>;
  onCreated: (projectId: string) => void;
};
