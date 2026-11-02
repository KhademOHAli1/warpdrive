import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { Result } from "@/types/result";
import type { ProjectCreateInput } from "../projectCreationInput";
import type { SelectedProjectStaff } from "../projectCreationPlan";
import type { ProjectSnapshot } from "../projectLifecycle";
import type { ProjectStartInput } from "./projectStartInput";

export type { ProjectStartInput } from "./projectStartInput";

/**
 * project_unavailable is privacy-generic: it also covers a previously committed receipt whose
 * current access, key or disposition is unavailable. It does not establish that this intent never
 * committed. UI transports must retain uncertain recovery unless they have affirmative noncommit
 * evidence, rather than converting every denial into a confirmed rejected/unavailable form result.
 */
export type ProjectRepositoryError =
  | "project_unavailable"
  | "intent_conflict"
  | "revision_conflict"
  | "invalid_transition"
  | "revision_exhausted"
  | "unknown";

export type ProjectReceipt = Readonly<{ projectId: string; revision: number }>;
export type ProjectReadModel = ProjectSnapshot &
  Readonly<{
    id: string;
    title: string;
    ownerUserId: string;
    dealId: string | null;
    personId: string | null;
    orgId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

export type ProjectReplayOperation = "create" | "start";
export type ProjectReplayInput = Readonly<ProjectCreateInput> | ProjectStartInput;
export type ProjectReplayContext = ProjectReceipt &
  Readonly<{
    actorUserId: string;
    operation: ProjectReplayOperation;
    intentId: string;
    historyId: string;
  }>;
export type ProjectReplayEnvelope = Readonly<{ keyId: string; bytes: Buffer }>;

// The binding owns canonical semantic comparison, domain AAD, keys and disposition handling.
export type ProjectReplayCodec = {
  seal: (
    context: ProjectReplayContext,
    input: ProjectReplayInput,
    signal: AbortSignal,
  ) => Promise<Result<ProjectReplayEnvelope, "project_unavailable">>;
  compare: (
    context: ProjectReplayContext,
    envelope: ProjectReplayEnvelope,
    input: ProjectReplayInput,
    signal: AbortSignal,
  ) => Promise<Result<boolean, "project_unavailable">>;
};

export type ProjectTransactionContext = {
  db: DbOrTx;
  actor: PermSetUser;
  authorizeCreate: (
    input: Readonly<ProjectCreateInput>,
    signal: AbortSignal,
  ) => Promise<
    Result<
      {
        creator: SelectedProjectStaff;
        selectedOwner: SelectedProjectStaff;
      },
      "project_unavailable"
    >
  >;
  authorizeProject: (
    project: ProjectReadModel,
    action: "read" | "start" | "replay",
    signal: AbortSignal,
  ) => Promise<Result<void, "project_unavailable">>;
};

/**
 * Acquire the native authority fence before invoking work; all relevant authority, revocation and
 * restriction writers must participate. Derive the actor and persisted module/session gates
 * natively. In READ COMMITTED, authorize callbacks recheck live session, accepted actor, policy,
 * grants and CRM/Privacy authority without touches after private locks. Hold the fence through
 * COMMIT, roll back failed Results, preserve cancellation and bound all I/O. Return unknown when
 * COMMIT acknowledgement is uncertain.
 * No production implementation is supplied by this repository.
 */
export type ProjectAuthorityTransaction = {
  run: <T>(
    signal: AbortSignal,
    work: (context: ProjectTransactionContext) => Promise<Result<T, ProjectRepositoryError>>,
  ) => Promise<Result<T, ProjectRepositoryError>>;
};

export type ProjectRepositoryBindings = {
  authority: ProjectAuthorityTransaction | null;
  codec: ProjectReplayCodec | null;
};
