import { and, eq, isNull } from "drizzle-orm";
import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflows, workflowVersions } from "@/db/schema";
import { prepareCurrentCustomFieldValidation } from "@/features/custom-fields/currentValidation";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { hydrateActor } from "@/server/hydrateActor";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { validateDefinition } from "./definition";
import { executableDefinition, requiresHumanForm } from "./readiness";
import { definitionSchema, type WorkflowDefinition } from "./schemas";
import {
  authenticateWorkflowWebhook,
  validWorkflowWebhookRequestShape,
  type WorkflowWebhookAuthFailure,
  type WorkflowWebhookRequest,
} from "./workflowWebhookAuth";
import {
  readWorkflowWebhookTrigger,
  type WorkflowWebhookLaunchPayload,
  type WorkflowWebhookPublication,
  workflowWebhookLaunchPayload,
  workflowWebhookLimits,
  workflowWebhookPublicationSchema,
} from "./workflowWebhookContract";

type WorkflowTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type AdmissionError = ErrorId | WorkflowWebhookAuthFailure;

export interface WorkflowWebhookRunInsert {
  workflowId: string;
  versionId: string;
  actorId: string;
  requestKey: string;
  mode: "live";
  trigger: WorkflowWebhookLaunchPayload;
  nextNodeId: string;
}

export interface WorkflowWebhookAdmissionServices {
  // The workflow's operator-managed secret is bound to its authorized owner.
  // Secret rotation must serialize on the same workflow row lock as admission.
  readSigningKey(
    db: DbOrTx,
    workflowId: string,
    signal: AbortSignal,
  ): Promise<{ ownerId: string; signingKey: string } | null>;
  insertRun(tx: WorkflowTx, run: WorkflowWebhookRunInsert): Promise<{ id: string } | undefined>;
}

async function lockWorkflow(tx: WorkflowTx, id: string, signal: AbortSignal) {
  const [workflow] = await tx
    .select({ ownerId: workflows.ownerId, publishedNumber: workflows.publishedNumber })
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.active, true), isNull(workflows.archivedAt)))
    .for("update");
  signal.throwIfAborted();
  return workflow === undefined || workflow.publishedNumber === null
    ? null
    : { ownerId: workflow.ownerId, publishedNumber: workflow.publishedNumber };
}

async function readPinnedWebhook(
  tx: WorkflowTx,
  { workflowId, versionId }: WorkflowWebhookPublication,
  publishedNumber: number,
  signal: AbortSignal,
) {
  const [version] = await tx
    .select({ definition: workflowVersions.definition })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.id, versionId),
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.number, publishedNumber),
      ),
    );
  signal.throwIfAborted();
  if (version === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const parsed = definitionSchema.safeParse(version.definition);
  if (!parsed.success || !executableDefinition(parsed.data))
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const trigger = readWorkflowWebhookTrigger(parsed.data);
  if (trigger === null) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  return ok({ definition: parsed.data, trigger });
}

async function webhookOwnerMayLaunch(
  tx: WorkflowTx,
  ownerId: string,
  definition: WorkflowDefinition,
  payload: WorkflowWebhookLaunchPayload,
  signal: AbortSignal,
) {
  const owner = await hydrateActor(tx, ownerId, signal);
  if (owner === null || owner.id !== ownerId || !canWorkflow(owner, "run", ownerId)) return false;
  if (requiresHumanForm(definition) && !canWorkflow(owner, "view")) return false;
  return (
    payload.httpMethod === "GET" || (await webhookDealVisible(tx, owner, payload.recordId, signal))
  );
}

async function webhookDealVisible(
  tx: WorkflowTx,
  owner: PermSetUser,
  recordId: string,
  signal: AbortSignal,
) {
  const visible = await assertReferenceVisible(
    tx,
    {
      userId: owner.id,
      isActive: owner.isActive,
      isAdmin: owner.type === "admin",
      sessionLive: true,
      visibilityGroupIds: [...owner.groupIds],
      managedUserIds: [...(owner.managedUserIds ?? [])],
    },
    { kind: "deal", id: recordId },
    signal,
  );
  return visible.ok;
}

function sameLaunch(
  existing: WorkflowWebhookLaunchPayload,
  requested: WorkflowWebhookLaunchPayload,
) {
  if (existing.httpMethod !== requested.httpMethod || existing.eventId !== requested.eventId)
    return false;
  return (
    existing.httpMethod === "GET" ||
    (requested.httpMethod === "POST" && existing.recordId === requested.recordId)
  );
}

async function readWebhookReplay(
  tx: WorkflowTx,
  run: WorkflowWebhookRunInsert,
  signal: AbortSignal,
) {
  const receipts = await tx
    .select({
      id: workflowRuns.id,
      actorId: workflowRuns.actorId,
      versionId: workflowRuns.versionId,
      mode: workflowRuns.mode,
      trigger: workflowRuns.trigger,
    })
    .from(workflowRuns)
    .where(
      and(eq(workflowRuns.workflowId, run.workflowId), eq(workflowRuns.requestKey, run.requestKey)),
    )
    .limit(2);
  signal.throwIfAborted();
  const existing = receipts[0];
  if (existing === undefined) return ok(null);
  const previous = workflowWebhookLaunchPayload.safeParse(existing.trigger);
  if (
    receipts.length !== 1 ||
    existing.actorId !== run.actorId ||
    existing.versionId !== run.versionId ||
    existing.mode !== run.mode ||
    !previous.success ||
    !sameLaunch(previous.data, run.trigger)
  )
    return err(ERROR_IDS.WORKFLOW_CONFLICT);
  return ok(existing.id);
}

async function writeWebhookAdmission(
  tx: WorkflowTx,
  run: WorkflowWebhookRunInsert,
  definition: WorkflowDefinition,
  signedAtMs: number,
  insertRun: WorkflowWebhookAdmissionServices["insertRun"],
  signal: AbortSignal,
) {
  const replay = await readWebhookReplay(tx, run, signal);
  if (!replay.ok) return replay;
  if (replay.value !== null)
    return signatureCurrent(signedAtMs)
      ? ok({ runId: replay.value, replayed: true })
      : err("unauthorized" as const);
  const defs = definition.nodes.some((node) => node.type === "activity.create")
    ? (await prepareCurrentCustomFieldValidation(tx, "activity", signal)).defs
    : [];
  if (!validateDefinition(definition, { status: "complete", defs }).ok)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  signal.throwIfAborted();
  if (!signatureCurrent(signedAtMs)) return err("unauthorized" as const);
  const inserted = await insertRun(tx, run);
  signal.throwIfAborted();
  return inserted === undefined
    ? err(ERROR_IDS.WORKFLOW_WRITE_FAILED)
    : ok({ runId: inserted.id, replayed: false });
}

function signatureCurrent(signedAtMs: number) {
  return Math.abs(Date.now() - signedAtMs) <= workflowWebhookLimits.clockSkewMs;
}

async function admitLockedWebhook(
  tx: WorkflowTx,
  request: WorkflowWebhookRequest,
  authorizedOwnerId: string,
  services: WorkflowWebhookAdmissionServices,
  signal: AbortSignal,
) {
  const { workflowId, versionId } = request.publication;
  const workflow = await lockWorkflow(tx, workflowId, signal);
  if (workflow === null || authorizedOwnerId !== workflow.ownerId)
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const key = await services.readSigningKey(tx, workflowId, signal);
  signal.throwIfAborted();
  if (key?.ownerId !== workflow.ownerId) return err("unauthorized" as const);
  const authorized = authenticateWorkflowWebhook({
    ...request,
    signingKey: key.signingKey,
    nowMs: Date.now(),
  });
  if (!authorized.ok) return authorized;

  const pinned = await readPinnedWebhook(tx, request.publication, workflow.publishedNumber, signal);
  if (!pinned.ok) return pinned;
  const { definition, trigger } = pinned.value;
  const { payload, replayKey } = authorized.value;
  if (trigger.config.httpMethod !== payload.httpMethod) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (!(await webhookOwnerMayLaunch(tx, workflow.ownerId, definition, payload, signal)))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  return writeWebhookAdmission(
    tx,
    {
      workflowId,
      versionId,
      actorId: workflow.ownerId,
      requestKey: replayKey,
      mode: "live",
      trigger: payload,
      nextNodeId: trigger.id,
    },
    definition,
    authorized.value.signedAtMs,
    (database, row) => services.insertRun(database, row),
    signal,
  );
}

// Public transport must bound the stream before invoking this function. Use the
// returned ID only after commit. The injected writer never enqueues or publishes.
export async function admitWorkflowWebhookDelivery(
  db: Db,
  input: WorkflowWebhookRequest,
  services: WorkflowWebhookAdmissionServices,
  signal: AbortSignal,
): Promise<Result<{ runId: string; replayed: boolean }, AdmissionError>> {
  signal.throwIfAborted();
  if (!validWorkflowWebhookRequestShape(input)) return err("invalid-request");
  const publication = workflowWebhookPublicationSchema.safeParse(input.publication);
  if (!publication.success) return err("unauthorized");
  const request = { ...input, publication: publication.data, rawBody: Buffer.from(input.rawBody) };
  try {
    const key = await services.readSigningKey(db, request.publication.workflowId, signal);
    signal.throwIfAborted();
    if (key === null) return err("unauthorized");
    const authorized = authenticateWorkflowWebhook({
      ...request,
      signingKey: key.signingKey,
      nowMs: Date.now(),
    });
    if (!authorized.ok) return authorized;
    return await db.transaction((tx) =>
      admitLockedWebhook(tx, request, key.ownerId, services, signal),
    );
  } catch {
    signal.throwIfAborted();
    return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  }
}
