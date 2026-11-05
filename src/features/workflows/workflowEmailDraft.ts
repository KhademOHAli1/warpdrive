import { createHash, randomUUID } from "node:crypto";
import { TransactionRollbackError } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { type DraftInput, saveDraft } from "@/features/email/draftRepo";
import { plainTextToParagraphHtml } from "@/features/email/plainText";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";
import {
  type WorkflowEmailDraftConfig,
  workflowEmailDraftCompose,
  workflowEmailDraftConfig,
  workflowEmailDraftFields,
} from "./workflowEmailDraftContract";

export type WorkflowEmailDraftScope =
  | { mode: "live" | "simulation"; runId: string }
  | { mode: "draft-simulation" };

type DraftNode = { id: string; version: number; config: unknown };
type DraftResult = Result<StepOutput, string>;

function draftCreationId(
  scope: WorkflowEmailDraftScope,
  actorId: string,
  nodeId: string,
  accountId: string,
): string {
  if (scope.mode === "draft-simulation") return randomUUID();
  // A scoped custom UUID v8 fits the draft repo's replayable createId contract.
  const bytes = createHash("sha256")
    .update(
      JSON.stringify([
        "warpdrive:workflow-email-draft:v1",
        scope.mode,
        scope.runId,
        nodeId,
        actorId,
        accountId,
      ]),
    )
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resolveComposeFields(
  config: WorkflowEmailDraftConfig,
  nodeId: string,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
) {
  const values: Record<string, unknown> = {};
  for (const { key } of workflowEmailDraftFields) {
    const binding = config[key];
    if (binding === undefined) continue;
    if (binding.kind === "value") {
      values[key] = binding.value;
      continue;
    }
    const resolved = resolveRunBinding(binding, outputs, { definition, nodeId, path: [key] });
    if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
    if (resolved.state !== "value") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
    values[key] = resolved.value;
  }
  const parsed = workflowEmailDraftCompose.safeParse(values);
  return parsed.success ? ok(parsed.data) : err(ERROR_IDS.WORKFLOW_INVALID);
}

async function writeDraft(
  tx: Db,
  actor: PermSetUser,
  draft: DraftInput,
  signal: AbortSignal,
): Promise<DraftResult> {
  const result = await saveDraft(tx, { actor, draft }, signal);
  signal.throwIfAborted();
  return result.ok ? ok({ id: result.value.id }) : err(result.error.id);
}

async function previewDraft(
  db: Db,
  actor: PermSetUser,
  draft: DraftInput,
  signal: AbortSignal,
): Promise<DraftResult> {
  let result: DraftResult = err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const rollback = { requested: false };
  try {
    await db.transaction(async (tx) => {
      result = await writeDraft(tx, actor, draft, signal);
      rollback.requested = true;
      tx.rollback();
    });
  } catch (error) {
    signal.throwIfAborted();
    if (!rollback.requested || !(error instanceof TransactionRollbackError)) throw error;
  }
  return result;
}

export async function createWorkflowEmailDraft(
  db: Db,
  actor: PermSetUser,
  node: DraftNode,
  outputs: RunOutputs,
  definition: WorkflowDefinition,
  scope: WorkflowEmailDraftScope,
  signal: AbortSignal,
): Promise<DraftResult> {
  signal.throwIfAborted();
  if (node.version !== 1) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  // Live writes must share the transaction that records the step and advances the run.
  if (!("rollback" in db)) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const config = workflowEmailDraftConfig.safeParse(node.config);
  if (!config.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const fields = resolveComposeFields(config.data, node.id, outputs, definition);
  if (!fields.ok) return fields;
  const { accountId } = config.data;
  const { to, cc, bcc, subject, body } = fields.value;
  const draft: DraftInput = {
    createId: draftCreationId(scope, actor.id, node.id, accountId),
    accountId,
    toEmails: to,
    ccEmails: cc,
    bccEmails: bcc,
    subject,
    bodyHtml: plainTextToParagraphHtml(body),
    visibility: "private",
  };
  return scope.mode === "live"
    ? writeDraft(db, actor, draft, signal)
    : previewDraft(db, actor, draft, signal);
}
