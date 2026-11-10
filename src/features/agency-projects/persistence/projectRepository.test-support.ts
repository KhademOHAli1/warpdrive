import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, TransactionRollbackError } from "drizzle-orm";
import { users } from "@/db/schema/identity";
import { err, ok, type Result } from "@/types/result";
import type { ProjectSchemaFixture } from "./projectPersistence.seeds";
import {
  createProjectRepository,
  type ProjectAuthorityTransaction,
  type ProjectRepositoryBindings,
  type ProjectRepositoryError,
  type ProjectTransactionContext,
} from "./projectRepository";

// Business-persistence fixture only. This is not the missing native session/fence/codec binding.
export type RepositoryFixtureOptions = {
  actorId?: string;
  grantCreate?: boolean;
  denyProject?: boolean;
  sealUnavailable?: boolean;
  unknownAfterCommit?: boolean;
};

export function repositoryFixture(f: ProjectSchemaFixture, options: RepositoryFixtureOptions = {}) {
  const actorId = options.actorId ?? f.actorId;
  const calls = { transactions: 0, projectAdmissions: 0 };
  const authority: ProjectAuthorityTransaction = {
    async run<T>(
      signal: AbortSignal,
      work: (context: ProjectTransactionContext) => Promise<Result<T, ProjectRepositoryError>>,
    ): Promise<Result<T, ProjectRepositoryError>> {
      signal.throwIfAborted();
      calls.transactions++;
      let failed: Result<T, ProjectRepositoryError> | undefined;
      try {
        const result = await f.db.db.transaction(async (tx) => {
          const [nativeActor] = await tx.select().from(users).where(eq(users.id, actorId));
          signal.throwIfAborted();
          assert(nativeActor);
          const outcome = await work({
            db: tx,
            actor: {
              id: actorId,
              type: nativeActor.isAdmin ? "admin" : "regular",
              isActive: nativeActor.isActive,
              groupIds: new Set(),
              flags: new Set(options.grantCreate === false ? [] : ["project.create"]),
            },
            authorizeCreate: async (input, admissionSignal) => {
              admissionSignal.throwIfAborted();
              const [selectedOwner] = await tx
                .select()
                .from(users)
                .where(eq(users.id, input.ownerUserId));
              admissionSignal.throwIfAborted();
              return selectedOwner === undefined
                ? err("project_unavailable")
                : ok({ creator: nativeActor, selectedOwner });
            },
            authorizeProject: (_project, _action, admissionSignal) => {
              admissionSignal.throwIfAborted();
              calls.projectAdmissions++;
              return Promise.resolve(
                options.denyProject === true ? err("project_unavailable") : ok(undefined),
              );
            },
          });
          signal.throwIfAborted();
          if (!outcome.ok) {
            failed = outcome;
            tx.rollback();
          }
          return outcome;
        });
        // A committed real transaction with an injected lost response, not a network/COMMIT-stall proof.
        return options.unknownAfterCommit === true && result.ok ? err("unknown") : result;
      } catch (error) {
        if (error instanceof TransactionRollbackError && failed !== undefined) return failed;
        throw error;
      }
    },
  };
  const bindings: ProjectRepositoryBindings = {
    authority,
    codec: {
      seal: (context, input, signal) => {
        signal.throwIfAborted();
        return Promise.resolve(
          options.sealUnavailable === true
            ? err("project_unavailable")
            : ok({
                keyId: "test-only-hmac-key",
                bytes: createHmac("sha256", "synthetic-test-key-only")
                  .update(JSON.stringify({ context, input }))
                  .digest(),
              }),
        );
      },
      compare: (context, envelope, input, signal) => {
        signal.throwIfAborted();
        const expected = createHmac("sha256", "synthetic-test-key-only")
          .update(JSON.stringify({ context, input }))
          .digest();
        return Promise.resolve(
          envelope.keyId !== "test-only-hmac-key" || envelope.bytes.length !== expected.length
            ? err("project_unavailable")
            : ok(timingSafeEqual(envelope.bytes, expected)),
        );
      },
    },
  };
  return { repository: createProjectRepository(bindings), bindings, calls };
}

export function success<T>(result: Result<T, unknown>): T {
  assert(result.ok, "Expected a successful repository result");
  return result.value;
}
