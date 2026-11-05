import { and, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema/workflowExecutions";
import { workflowExternalEffects } from "@/db/schema/workflowExternalEffects";
import { workflows, workflowVersions } from "@/db/schema/workflows";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import {
  type WorkflowExternalEffectCompletion,
  type WorkflowExternalEffectIdentity,
  workflowExternalEffectAbandonAfterMs,
  workflowExternalEffectCompletion,
  workflowExternalEffectDigest,
  workflowExternalEffectErrorId,
  workflowExternalEffectIdentity,
} from "./workflowExternalEffectContract";

export type WorkflowExternalEffectTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type WorkflowExternalEffect = typeof workflowExternalEffects.$inferSelect;
type Run = typeof workflowRuns.$inferSelect;
type Workflow = typeof workflows.$inferSelect;
type EffectResult<T> = Result<T, string>;

const acquired = Symbol("workflowExternalEffectAcquired");
const authorizedDispatch = Symbol("workflowExternalEffectAuthorized");
const acquiredClaims = new WeakSet<object>();
const dispatchProofs = new WeakMap<object, number>();
const maxClockSkewMs = 5_000;
export const workflowExternalEffectMaxDispatchAgeMs = 15_000;
const freshnessBoundary = sql`clock_timestamp() - (${workflowExternalEffectAbandonAfterMs}::double precision * interval '1 millisecond')`;
const completionTime = sql`greatest(clock_timestamp(), coalesce(${workflowExternalEffects.dispatchAuthorizedAt}, ${workflowExternalEffects.startedAt}))`;

export interface WorkflowExternalEffectClaim {
  readonly [acquired]: true;
  readonly identity: Readonly<WorkflowExternalEffectIdentity>;
  readonly attemptId: string;
  readonly requestDigest: string;
}

export interface WorkflowExternalEffectDispatch {
  readonly [authorizedDispatch]: true;
  readonly executionKey: string;
  readonly requestDigest: string;
  readonly dispatchAuthorizedAt: Date;
}

export function isWorkflowExternalEffectDispatch(
  raw: unknown,
): raw is WorkflowExternalEffectDispatch {
  return raw !== null && typeof raw === "object" && dispatchProofs.has(raw);
}

export function isFreshWorkflowExternalEffectDispatch(
  raw: unknown,
  nowMs = Date.now(),
): raw is WorkflowExternalEffectDispatch {
  if (!isWorkflowExternalEffectDispatch(raw)) return false;
  const issued = dispatchProofs.get(raw);
  if (issued === undefined) return false;
  const age = nowMs - issued;
  return (
    Number.isFinite(age) && age >= -maxClockSkewMs && age <= workflowExternalEffectMaxDispatchAgeMs
  );
}

export function consumeWorkflowExternalEffectDispatch(raw: unknown): boolean {
  return isFreshWorkflowExternalEffectDispatch(raw) && dispatchProofs.delete(raw);
}

type ClaimResult =
  | { state: "acquired"; claim: WorkflowExternalEffectClaim }
  | { state: "observed"; effect: WorkflowExternalEffect };

function identityFilter(identity: Readonly<WorkflowExternalEffectIdentity>) {
  return and(
    eq(workflowExternalEffects.runId, identity.runId),
    eq(workflowExternalEffects.nodeId, identity.nodeId),
    eq(workflowExternalEffects.iterationIndex, identity.iterationIndex),
    eq(workflowExternalEffects.kind, identity.kind),
  );
}

function exactClaim(claim: WorkflowExternalEffectClaim) {
  return and(
    identityFilter(claim.identity),
    eq(workflowExternalEffects.attemptId, claim.attemptId),
    eq(workflowExternalEffects.requestDigest, claim.requestDigest),
    eq(workflowExternalEffects.state, "started"),
  );
}

async function lockRun(tx: WorkflowExternalEffectTx, runId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const [run] = await tx
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .for("update");
  signal.throwIfAborted();
  return run;
}

function atCursor(run: Run, identity: Readonly<WorkflowExternalEffectIdentity>): boolean {
  const iteration = run.iteratorFrame === null ? -1 : run.iteratorFrame.itemIndex;
  return (
    run.mode === "live" &&
    (run.status === "queued" || run.status === "running") &&
    run.nextNodeId === identity.nodeId &&
    iteration === identity.iterationIndex
  );
}

async function readEffect(
  tx: WorkflowExternalEffectTx,
  identity: Readonly<WorkflowExternalEffectIdentity>,
) {
  const [row] = await tx.select().from(workflowExternalEffects).where(identityFilter(identity));
  return row;
}

// The worker has already validated its pinned plan. The unique claim and the
// current cursor are protected by the same run lock. An observed claim does not
// return the private in-memory capability required to authorize dispatch.
export async function claimWorkflowExternalEffect(
  tx: WorkflowExternalEffectTx,
  identity: WorkflowExternalEffectIdentity,
  requestDigest: string,
  signal: AbortSignal,
): Promise<EffectResult<ClaimResult>> {
  const parsed = workflowExternalEffectIdentity.safeParse(identity);
  if (!parsed.success || !workflowExternalEffectDigest.safeParse(requestDigest).success)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const run = await lockRun(tx, parsed.data.runId, signal);
  if (run === undefined || !atCursor(run, parsed.data)) return err(ERROR_IDS.WORKFLOW_DENIED);
  const [created] = await tx
    .insert(workflowExternalEffects)
    .values({ ...parsed.data, requestDigest })
    .onConflictDoNothing({
      target: [
        workflowExternalEffects.runId,
        workflowExternalEffects.nodeId,
        workflowExternalEffects.iterationIndex,
        workflowExternalEffects.kind,
      ],
    })
    .returning();
  signal.throwIfAborted();
  if (created !== undefined) {
    const claim: WorkflowExternalEffectClaim = {
      [acquired]: true,
      identity: Object.freeze({ ...parsed.data, runId: created.runId }),
      attemptId: created.attemptId,
      requestDigest,
    };
    acquiredClaims.add(claim);
    return ok({ state: "acquired", claim: Object.freeze(claim) });
  }
  const existing = await readEffect(tx, parsed.data);
  signal.throwIfAborted();
  if (existing === undefined) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  return existing.requestDigest === requestDigest
    ? ok({ state: "observed", effect: existing })
    : err(ERROR_IDS.WORKFLOW_CONFLICT);
}

interface AuthorizationContext {
  tx: WorkflowExternalEffectTx;
  run: Run;
  workflow: Workflow;
  actor: PermSetUser;
  definition: WorkflowDefinition;
  node: WorkflowNode;
  signal: AbortSignal;
}

type Reauthorize<T> = (
  context: AuthorizationContext,
) =>
  | EffectResult<{ requestDigest: string; value: T }>
  | Promise<EffectResult<{ requestDigest: string; value: T }>>;

async function authorizationContext(
  tx: WorkflowExternalEffectTx,
  run: Run,
  identity: Readonly<WorkflowExternalEffectIdentity>,
  signal: AbortSignal,
): Promise<EffectResult<AuthorizationContext>> {
  const actor = await hydrateActor(tx, run.actorId, signal);
  const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (
    actor === null ||
    workflow === undefined ||
    workflow.archivedAt !== null ||
    !canWorkflow(actor, "run", workflow.ownerId)
  )
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const [version] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(eq(workflowVersions.id, run.versionId), eq(workflowVersions.workflowId, run.workflowId)),
    );
  const definition = definitionSchema.safeParse(version?.definition);
  if (!definition.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const node = definition.data.nodes.find((candidate) => candidate.id === identity.nodeId);
  if (node === undefined || node.type !== identity.kind) return err(ERROR_IDS.WORKFLOW_INVALID);
  return ok({ tx, run, workflow, actor, definition: definition.data, node, signal });
}

// Call on the top-level database only after the claim transaction commits.
// Reauthorization is DB/policy work only. Its return value may contain an
// ephemeral dispatch plan, which never enters this table or job payload.
export async function authorizeWorkflowExternalEffect<T>(
  db: Db,
  claim: WorkflowExternalEffectClaim,
  reauthorize: Reauthorize<T>,
  signal: AbortSignal,
): Promise<EffectResult<{ dispatch: WorkflowExternalEffectDispatch; value: T }>> {
  if (!acquiredClaims.has(claim) || "rollback" in db) return err(ERROR_IDS.WORKFLOW_DENIED);
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, claim.identity.runId, signal);
    if (run === undefined || !atCursor(run, claim.identity)) return err(ERROR_IDS.WORKFLOW_DENIED);
    const [pending] = await tx
      .select({ attemptId: workflowExternalEffects.attemptId })
      .from(workflowExternalEffects)
      .where(
        and(
          exactClaim(claim),
          isNull(workflowExternalEffects.dispatchAuthorizedAt),
          gt(workflowExternalEffects.startedAt, freshnessBoundary),
        ),
      );
    if (pending === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
    const current = await authorizationContext(tx, run, claim.identity, signal);
    if (!current.ok) return current;
    const checked = await reauthorize(current.value);
    signal.throwIfAborted();
    if (!checked.ok) {
      const safeError = workflowExternalEffectErrorId.safeParse(checked.error);
      return err(safeError.success ? safeError.data : ERROR_IDS.WORKFLOW_DENIED);
    }
    if (checked.value.requestDigest !== claim.requestDigest)
      return err(ERROR_IDS.WORKFLOW_CONFLICT);
    const [armed] = await tx
      .update(workflowExternalEffects)
      .set({
        dispatchAuthorizedAt: sql`greatest(clock_timestamp(), ${workflowExternalEffects.startedAt})`,
      })
      .where(
        and(
          exactClaim(claim),
          isNull(workflowExternalEffects.dispatchAuthorizedAt),
          gt(workflowExternalEffects.startedAt, freshnessBoundary),
        ),
      )
      .returning({ dispatchAuthorizedAt: workflowExternalEffects.dispatchAuthorizedAt });
    signal.throwIfAborted();
    if (armed?.dispatchAuthorizedAt == null) return err(ERROR_IDS.WORKFLOW_CONFLICT);
    const dispatch: WorkflowExternalEffectDispatch = {
      [authorizedDispatch]: true,
      executionKey: claim.attemptId,
      requestDigest: claim.requestDigest,
      dispatchAuthorizedAt: armed.dispatchAuthorizedAt,
    };
    dispatchProofs.set(dispatch, armed.dispatchAuthorizedAt.getTime());
    return ok({ dispatch: Object.freeze(dispatch), value: checked.value.value });
  });
}

// Settlement records the observed outcome even if the run was cancelled while
// the request was in flight. The caller decides whether its cursor can advance.
export async function completeWorkflowExternalEffect(
  tx: WorkflowExternalEffectTx,
  claim: WorkflowExternalEffectClaim,
  completion: WorkflowExternalEffectCompletion,
  signal: AbortSignal,
): Promise<EffectResult<WorkflowExternalEffect>> {
  if (!acquiredClaims.has(claim)) return err(ERROR_IDS.WORKFLOW_DENIED);
  const parsed = workflowExternalEffectCompletion.safeParse(completion);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const run = await lockRun(tx, claim.identity.runId, signal);
  if (run === undefined) return err(ERROR_IDS.WORKFLOW_DENIED);
  const { state } = parsed.data;
  const [done] = await tx
    .update(workflowExternalEffects)
    .set({
      state,
      finishedAt: completionTime,
      output: "output" in parsed.data ? parsed.data.output : null,
      errorId: "errorId" in parsed.data ? parsed.data.errorId : null,
    })
    .where(
      and(
        exactClaim(claim),
        state === "not_sent" ? undefined : isNotNull(workflowExternalEffects.dispatchAuthorizedAt),
      ),
    )
    .returning();
  signal.throwIfAborted();
  return done === undefined ? err(ERROR_IDS.WORKFLOW_CONFLICT) : ok(done);
}

// Recovery observes existing receipts and only seals aged attempts. It never
// acquires a dispatch capability or deletes an attempt, even after a crash.
export async function recoverWorkflowExternalEffect(
  tx: WorkflowExternalEffectTx,
  identity: WorkflowExternalEffectIdentity,
  signal: AbortSignal,
): Promise<EffectResult<WorkflowExternalEffect | null>> {
  const parsed = workflowExternalEffectIdentity.safeParse(identity);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const run = await lockRun(tx, parsed.data.runId, signal);
  if (run === undefined) return err(ERROR_IDS.WORKFLOW_DENIED);
  const observed = await readEffect(tx, parsed.data);
  signal.throwIfAborted();
  if (observed?.state !== "started") return ok(observed ?? null);
  const [abandoned] = await tx
    .update(workflowExternalEffects)
    .set({
      state: observed.dispatchAuthorizedAt === null ? "not_sent" : "unknown",
      finishedAt: completionTime,
      errorId: ERROR_IDS.WORKFLOW_NOT_READY,
    })
    .where(
      and(
        eq(workflowExternalEffects.attemptId, observed.attemptId),
        eq(workflowExternalEffects.state, "started"),
        lte(
          sql`coalesce(${workflowExternalEffects.dispatchAuthorizedAt}, ${workflowExternalEffects.startedAt})`,
          freshnessBoundary,
        ),
      ),
    )
    .returning();
  signal.throwIfAborted();
  return ok(abandoned ?? observed);
}
