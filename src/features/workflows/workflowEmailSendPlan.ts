import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import { emailAccounts } from "@/db/schema/email";
import { users } from "@/db/schema/identity";
import { plainTextToParagraphHtml } from "@/features/email/plainText";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import type { WorkflowDefinition } from "./schemas";
import { workflowEmailDraftFields } from "./workflowEmailDraftContract";
import {
  type WorkflowEmailSendConfig,
  workflowEmailSendCompose,
  workflowEmailSendConfig,
} from "./workflowEmailSendContract";
import { workflowExternalEffectIdentity } from "./workflowExternalEffectContract";

const mailProviders = ["gmail", "imap_smtp"] as const;
export type WorkflowEmailSendProvider = (typeof mailProviders)[number];

interface WorkflowEmailSendPlanInput {
  actor: Pick<PermSetUser, "id" | "isActive">;
  node: { id: string; type: string; version: number; config: unknown };
  outputs: RunOutputs;
  definition: WorkflowDefinition;
  runId: string;
  iterationIndex: number;
}

interface WorkflowEmailSendOccurrence {
  readonly runId: string;
  readonly nodeId: string;
  readonly iterationIndex: number;
}

export interface WorkflowEmailSendMessage {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly visibility: "private";
}

export interface WorkflowEmailSendPlan extends WorkflowEmailSendOccurrence {
  readonly actorId: string;
  readonly accountId: string;
  readonly provider: WorkflowEmailSendProvider;
  readonly connectionGeneration: number;
  readonly idempotencyKey: string;
  readonly message: WorkflowEmailSendMessage;
  readonly requestDigest: string;
}

export function workflowEmailSendRequestKey(occurrence: WorkflowEmailSendOccurrence): string {
  const bytes = createHash("sha256")
    .update(
      JSON.stringify([
        "warpdrive.workflow.email.send.v1",
        occurrence.runId,
        occurrence.nodeId,
        occurrence.iterationIndex,
      ]),
    )
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function workflowEmailSendRequestDigest(
  plan: Omit<WorkflowEmailSendPlan, "requestDigest">,
): string {
  const { message } = plan;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "warpdrive.workflow.email.send.plan.v1",
        plan.runId,
        plan.nodeId,
        plan.iterationIndex,
        plan.actorId,
        plan.accountId,
        plan.provider,
        plan.connectionGeneration,
        plan.idempotencyKey,
        message.to,
        message.cc,
        message.bcc,
        message.subject,
        message.text,
        message.html,
        message.visibility,
      ]),
    )
    .digest("hex");
}

// This reads only mailbox authority metadata. Credentials are resolved by the
// native dispatch boundary after authorization commits, never while planning.
export async function readWorkflowEmailSendMailbox(
  db: DbOrTx,
  accountId: string,
  actorId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const [row] = await db
    .select({
      provider: emailAccounts.provider,
      connectionGeneration: emailAccounts.connectionGeneration,
    })
    .from(emailAccounts)
    .innerJoin(users, eq(users.id, emailAccounts.userId))
    .where(
      and(
        eq(emailAccounts.id, accountId),
        eq(emailAccounts.userId, actorId),
        eq(emailAccounts.status, "connected"),
        eq(emailAccounts.paused, false),
        eq(users.isActive, true),
        isNull(users.invitedAt),
        inArray(emailAccounts.provider, mailProviders),
        sql`coalesce(${emailAccounts.capabilities}->'send' = 'true'::jsonb, true)`,
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  if (row?.provider !== "gmail" && row?.provider !== "imap_smtp") return null;
  return { provider: row.provider, connectionGeneration: row.connectionGeneration };
}

function resolveWorkflowEmailSendMessage(
  config: WorkflowEmailSendConfig,
  input: WorkflowEmailSendPlanInput,
): Result<WorkflowEmailSendMessage, ErrorId> {
  const values: Record<string, unknown> = {};
  for (const { key } of workflowEmailDraftFields) {
    const binding = config[key];
    if (binding === undefined) continue;
    if (binding.kind === "value") {
      values[key] = binding.value;
      continue;
    }
    const resolved = resolveRunBinding(binding, input.outputs, {
      definition: input.definition,
      nodeId: input.node.id,
      path: [key],
    });
    if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
    if (resolved.state !== "value") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
    values[key] = resolved.value;
  }
  const parsed = workflowEmailSendCompose.safeParse(values);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const { to, cc, bcc, subject, body } = parsed.data;
  return ok(
    Object.freeze({
      to: Object.freeze(to),
      cc: Object.freeze(cc),
      bcc: Object.freeze(bcc),
      subject,
      text: body,
      html: plainTextToParagraphHtml(body),
      visibility: "private",
    }),
  );
}

export async function planWorkflowEmailSend(
  tx: DbOrTx,
  input: WorkflowEmailSendPlanInput,
  signal: AbortSignal,
): Promise<Result<{ value: WorkflowEmailSendPlan; requestDigest: string }, ErrorId>> {
  signal.throwIfAborted();
  if (!input.actor.isActive) return err(ERROR_IDS.WORKFLOW_DENIED);
  if (input.node.type !== "email.send" || input.node.version !== 1)
    return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const identity = workflowExternalEffectIdentity.safeParse({
    runId: input.runId,
    nodeId: input.node.id,
    iterationIndex: input.iterationIndex,
    kind: "email.send",
  });
  const config = workflowEmailSendConfig.safeParse(input.node.config);
  if (!identity.success || !config.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const message = resolveWorkflowEmailSendMessage(config.data, input);
  if (!message.ok) return message;
  const accountId = config.data.accountId.toLowerCase();
  const mailbox = await readWorkflowEmailSendMailbox(tx, accountId, input.actor.id, signal);
  if (mailbox === null) return err(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE);
  const { runId, nodeId, iterationIndex } = identity.data;
  const occurrence = { runId: runId.toLowerCase(), nodeId, iterationIndex };
  const draft = {
    ...occurrence,
    ...mailbox,
    actorId: input.actor.id,
    accountId,
    idempotencyKey: workflowEmailSendRequestKey(occurrence),
    message: message.value,
  };
  const requestDigest = workflowEmailSendRequestDigest(draft);
  return ok({ value: Object.freeze({ ...draft, requestDigest }), requestDigest });
}
