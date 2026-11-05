import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { workflowRuns } from "@/db/schema/workflowExecutions";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import {
  authorizeWorkflowExternalEffect,
  claimWorkflowExternalEffect,
  completeWorkflowExternalEffect,
  recoverWorkflowExternalEffect,
  type WorkflowExternalEffect,
  type WorkflowExternalEffectClaim,
  type WorkflowExternalEffectTx,
} from "./workflowExternalEffect";
import {
  type WorkflowExternalEffectCompletion,
  workflowExternalEffectCompletion,
  workflowExternalEffectErrorId,
} from "./workflowExternalEffectContract";
import {
  invokeWorkflowHttpRequest,
  prepareWorkflowHttpRequest,
  type WorkflowHttpRequestFailure,
  type WorkflowHttpRequestGrant,
  type WorkflowHttpRequestOutcome,
  type WorkflowHttpRequestPlan,
  type WorkflowHttpRequestPolicy,
} from "./workflowHttpRequest";
import { workflowHttpFailure } from "./workflowHttpRequestPlan";
import type { WorkflowHttpsDependencies } from "./workflowHttpRequestTransport";

const kind: string = "http.request";
const settlementTimeoutMs = 5_000;
type Run = typeof workflowRuns.$inferSelect;

export interface WorkflowHttpRequestWorkerContext {
  tx: WorkflowExternalEffectTx;
  run: Run;
  node: Pick<WorkflowNode, "id" | "config" | "version"> & { type: string };
  definition: WorkflowDefinition;
  actor: PermSetUser;
  workflowOwnerId: string;
  outputs?: RunOutputs;
}

export interface WorkflowHttpRequestWorkerServices {
  readGrants(
    context: { tx: WorkflowExternalEffectTx; workflowId: string; actorId: string },
    signal: AbortSignal,
  ): readonly WorkflowHttpRequestGrant[] | Promise<readonly WorkflowHttpRequestGrant[]>;
  // Iterator callers reconstruct the same pinned occurrence and recheck current
  // item visibility. A root run can use its stored step outputs directly.
  resolveOutputs?(
    context: WorkflowHttpRequestWorkerContext,
    signal: AbortSignal,
  ): Result<RunOutputs, string> | Promise<Result<RunOutputs, string>>;
}

type WorkerFailure =
  | WorkflowHttpRequestFailure
  | {
      id: ErrorId;
      reason: "receipt_unavailable" | "live_run_required" | "occurrence_unavailable";
    };

type Claim =
  | { state: "acquired"; claim: WorkflowExternalEffectClaim }
  | { state: "observed"; effect: WorkflowExternalEffect };

function safeError(raw: string, fallback: ErrorId): ErrorId {
  const parsed = workflowExternalEffectErrorId.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

function receiptFailure(raw: string): WorkerFailure {
  return { id: safeError(raw, ERROR_IDS.WORKFLOW_WRITE_FAILED), reason: "receipt_unavailable" };
}

function workerAuthorized({ actor, workflowOwnerId }: WorkflowHttpRequestWorkerContext) {
  return actor.type === "admin" && canWorkflow(actor, "run", workflowOwnerId);
}

async function loadOutputs(
  context: WorkflowHttpRequestWorkerContext,
  services: WorkflowHttpRequestWorkerServices,
  signal: AbortSignal,
): Promise<Result<RunOutputs, WorkerFailure>> {
  if (context.outputs !== undefined) return ok(context.outputs);
  if (context.run.iteratorFrame === null) return ok(context.run.outputs);
  const outputs = await services.resolveOutputs?.(context, signal);
  signal.throwIfAborted();
  return outputs?.ok === true
    ? outputs
    : err({
        id: safeError(outputs?.error ?? ERROR_IDS.WORKFLOW_NOT_READY, ERROR_IDS.WORKFLOW_INVALID),
        reason: "occurrence_unavailable",
      });
}

async function prepare(
  context: WorkflowHttpRequestWorkerContext,
  services: WorkflowHttpRequestWorkerServices,
  signal: AbortSignal,
): Promise<
  Result<{ plan: WorkflowHttpRequestPlan; policy: WorkflowHttpRequestPolicy }, WorkerFailure>
> {
  if (!workerAuthorized(context)) return err(workflowHttpFailure("unauthorized"));
  try {
    const outputs = await loadOutputs(context, services, signal);
    if (!outputs.ok) return outputs;
    const grants = await services.readGrants(
      {
        tx: context.tx,
        workflowId: context.run.workflowId,
        actorId: context.actor.id,
      },
      signal,
    );
    signal.throwIfAborted();
    const policy = { isWorkspaceAdmin: true, canRunWorkflow: true, grants };
    const planned = prepareWorkflowHttpRequest({
      node: context.node,
      outputs: outputs.value,
      definition: context.definition,
      policy,
    });
    return planned.ok ? ok({ plan: planned.value, policy }) : planned;
  } catch {
    signal.throwIfAborted();
    // Operator configuration failures are not provider-facing diagnostics.
    return err(workflowHttpFailure("unavailable"));
  }
}

// Called while the shared execution transaction holds the current run row lock.
// No request plan or operator credentials cross the commit in the claim result.
export async function claimWorkflowHttpRequest(
  context: WorkflowHttpRequestWorkerContext,
  services: WorkflowHttpRequestWorkerServices,
  signal: AbortSignal,
): Promise<Result<Claim, WorkerFailure>> {
  signal.throwIfAborted();
  const { node, run, tx } = context;
  if (run.mode !== "live")
    return err({ id: ERROR_IDS.WORKFLOW_NOT_READY, reason: "live_run_required" });
  if (node.type !== kind || node.id !== run.nextNodeId || context.actor.id !== run.actorId)
    return err(workflowHttpFailure("invalid_config"));
  if (run.status !== "queued" && run.status !== "running")
    return err(workflowHttpFailure("unauthorized"));
  if (!workerAuthorized(context)) return err(workflowHttpFailure("unauthorized"));
  const identity = {
    runId: run.id,
    nodeId: node.id,
    iterationIndex: run.iteratorFrame?.itemIndex ?? -1,
    kind,
  };
  const existing = await recoverWorkflowExternalEffect(tx, identity, signal);
  if (!existing.ok) return err(receiptFailure(existing.error));
  if (existing.value !== null) return ok({ state: "observed", effect: existing.value });
  const prepared = await prepare(context, services, signal);
  if (!prepared.ok) return prepared;
  const claim = await claimWorkflowExternalEffect(
    tx,
    identity,
    prepared.value.plan.requestDigest,
    signal,
  );
  return claim.ok ? claim : err(receiptFailure(claim.error));
}

function completion(outcome: WorkflowHttpRequestOutcome): WorkflowExternalEffectCompletion {
  if (outcome.result.ok) {
    const terminal = workflowExternalEffectCompletion.safeParse({
      state: "complete",
      output: outcome.result.value,
    });
    return terminal.success
      ? terminal.data
      : { state: "complete", errorId: ERROR_IDS.WORKFLOW_INVALID };
  }
  const errorId = safeError(outcome.result.error.id, ERROR_IDS.WORKFLOW_WRITE_FAILED);
  if (outcome.disposition === "unknown") return { state: "unknown", errorId };
  return { state: outcome.disposition === "not-sent" ? "not_sent" : "complete", errorId };
}

async function receiptForClaim(
  tx: WorkflowExternalEffectTx,
  claim: WorkflowExternalEffectClaim,
  signal: AbortSignal,
) {
  const receipt = await recoverWorkflowExternalEffect(tx, claim.identity, signal);
  if (!receipt.ok) return receipt;
  return receipt.value?.attemptId === claim.attemptId &&
    receipt.value.requestDigest === claim.requestDigest
    ? ok(receipt.value)
    : err(ERROR_IDS.WORKFLOW_CONFLICT);
}

async function settleAuthorizationFailure(
  db: Db,
  claim: WorkflowExternalEffectClaim,
  failure: string,
) {
  const signal = AbortSignal.timeout(settlementTimeoutMs);
  return db
    .transaction(async (tx) => {
      const receipt = await receiptForClaim(tx, claim, signal);
      if (
        !receipt.ok ||
        receipt.value.state !== "started" ||
        receipt.value.dispatchAuthorizedAt !== null
      )
        return receipt;
      return completeWorkflowExternalEffect(
        tx,
        claim,
        {
          state: "not_sent",
          errorId: safeError(failure, ERROR_IDS.WORKFLOW_WRITE_FAILED),
        },
        signal,
      );
    })
    .catch(() => err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
}

async function settle(
  db: Db,
  claim: WorkflowExternalEffectClaim,
  result: WorkflowExternalEffectCompletion,
) {
  const signal = AbortSignal.timeout(settlementTimeoutMs);
  return db
    .transaction(async (tx) => {
      const recorded = await completeWorkflowExternalEffect(tx, claim, result, signal);
      return !recorded.ok && recorded.error === ERROR_IDS.WORKFLOW_CONFLICT
        ? receiptForClaim(tx, claim, signal)
        : recorded;
    })
    .catch(() => err(ERROR_IDS.WORKFLOW_WRITE_FAILED));
}

// Run after the claim transaction commits. Reauthorization reconstructs the
// current plan from the pinned run and grants. There is one dispatch attempt.
// Settlement has its own short deadline so caller cancellation cannot discard
// a known provider receipt or turn it into a fresh send.
export async function dispatchClaimedWorkflowHttpRequest(
  db: Db,
  claim: WorkflowExternalEffectClaim,
  services: WorkflowHttpRequestWorkerServices,
  signal: AbortSignal,
  fixture?: WorkflowHttpsDependencies,
): Promise<Result<WorkflowExternalEffect, string>> {
  if (claim.identity.kind !== kind || "rollback" in db) return err(ERROR_IDS.WORKFLOW_INVALID);
  const authorized = await authorizeWorkflowExternalEffect(
    db,
    claim,
    async (current) => {
      const prepared = await prepare(
        { ...current, workflowOwnerId: current.workflow.ownerId },
        services,
        signal,
      );
      return prepared.ok
        ? ok({ requestDigest: prepared.value.plan.requestDigest, value: prepared.value })
        : err(prepared.error.id);
    },
    signal,
  ).catch(() => err(signal.aborted ? ERROR_IDS.WORKFLOW_DENIED : ERROR_IDS.WORKFLOW_WRITE_FAILED));
  if (!authorized.ok) return settleAuthorizationFailure(db, claim, authorized.error);
  const {
    dispatch,
    value: { plan, policy },
  } = authorized.value;
  const outcome = await invokeWorkflowHttpRequest(plan, dispatch, policy, signal, fixture)
    .then(completion)
    .catch(
      (): WorkflowExternalEffectCompletion => ({
        state: "unknown",
        errorId: ERROR_IDS.WORKFLOW_WRITE_FAILED,
      }),
    );
  return settle(db, claim, outcome);
}
