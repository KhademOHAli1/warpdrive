import { err, ok, type Result } from "@/types/result";
import type { ProjectCreateInput } from "../projectCreationInput";
import { authorizeProject } from "./projectRepositoryAccess";
import { createProject } from "./projectRepositoryCreate";
import { startProject } from "./projectRepositoryStart";
import type {
  ProjectAuthorityTransaction,
  ProjectReadModel,
  ProjectReceipt,
  ProjectRepositoryBindings,
  ProjectRepositoryError,
  ProjectStartInput,
  ProjectTransactionContext,
} from "./projectRepositoryTypes";

export type {
  ProjectAuthorityTransaction,
  ProjectReadModel,
  ProjectReceipt,
  ProjectReplayCodec,
  ProjectReplayContext,
  ProjectReplayEnvelope,
  ProjectReplayInput,
  ProjectRepositoryBindings,
  ProjectRepositoryError,
  ProjectStartInput,
  ProjectTransactionContext,
} from "./projectRepositoryTypes";
export { projectStartInputSchema } from "./projectStartInput";

async function withAuthority<T>(
  authority: ProjectAuthorityTransaction,
  signal: AbortSignal,
  work: (context: ProjectTransactionContext) => Promise<Result<T, ProjectRepositoryError>>,
) {
  signal.throwIfAborted();
  try {
    // The signal-aware binding owns the transaction outcome, including an uncertain COMMIT.
    return await authority.run(signal, work);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    signal.throwIfAborted();
    return err("unknown" as const);
  }
}

export function createProjectRepository(bindings: ProjectRepositoryBindings | null = null) {
  const authority = bindings?.authority ?? null;
  const codec = bindings?.codec ?? null;
  return {
    create(
      input: Readonly<ProjectCreateInput>,
      signal: AbortSignal,
    ): Promise<Result<ProjectReceipt, ProjectRepositoryError>> {
      signal.throwIfAborted();
      if (authority === null || codec === null) return Promise.resolve(err("project_unavailable"));
      // Capture only the six admitted fields before yielding to any external adapter.
      const command = Object.freeze({
        intentId: input.intentId,
        ownerUserId: input.ownerUserId,
        title: input.title,
        dealId: input.dealId,
        personId: input.personId,
        orgId: input.orgId,
      });
      return withAuthority(authority, signal, (context) =>
        createProject(context, command, codec, signal),
      );
    },
    read(
      projectId: string,
      signal: AbortSignal,
    ): Promise<Result<ProjectReadModel, ProjectRepositoryError>> {
      signal.throwIfAborted();
      if (authority === null) return Promise.resolve(err("project_unavailable"));
      return withAuthority(authority, signal, async (context) => {
        const admission = await authorizeProject(context, projectId, "read", signal);
        return admission.ok ? ok(admission.value.project) : admission;
      });
    },
    start(
      input: ProjectStartInput,
      signal: AbortSignal,
    ): Promise<Result<ProjectReceipt, ProjectRepositoryError>> {
      signal.throwIfAborted();
      if (authority === null || codec === null) return Promise.resolve(err("project_unavailable"));
      const command = Object.freeze({
        projectId: input.projectId,
        intentId: input.intentId,
        expectedRevision: input.expectedRevision,
      });
      return withAuthority(authority, signal, (context) =>
        startProject(context, command, codec, signal),
      );
    },
  };
}
