import { z } from "zod";
import type { Db } from "@/db/client";
import type { BlockOutput, NativeActionExecutor } from "@/features/blocks/contracts";
import { resolvedBlockConfigSchemas } from "@/features/blocks/schemas";
import { saveDraft } from "@/features/email/draftRepo";
import { assertSignatureOwner } from "@/features/email/mailboxOwnership";
import { sanitizeAuthorHtml } from "@/features/email/sanitizeHtml";
import { resolveDelivery } from "@/features/notifications/preferences";
import { createNotification } from "@/features/notifications/produce";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { localRecipientAvailable, localWorkflowActor, lockLocalUsers } from "./localAuthority";
import { createLocalCalendarEvent } from "./localCalendar";

export const executeLocalWorkflowAction: NativeActionExecutor = async (tx, args) => {
  const users = [args.actor.id];
  if (args.node.type === "SEND_CHAT_MESSAGE")
    users.push(resolvedBlockConfigSchemas.SEND_CHAT_MESSAGE.parse(args.resolvedConfig).recipientId);
  if (args.node.type === "CREATE_CALENDAR_EVENT")
    users.push(
      resolvedBlockConfigSchemas.CREATE_CALENDAR_EVENT.parse(args.resolvedConfig).assigneeId ??
        args.actor.id,
    );
  await lockLocalUsers(tx, users, args.signal);
  const actor = await localWorkflowActor(tx, args.actor.id, args.signal, false);
  if (actor === null) return err("E_PERM_001");
  if (args.node.type === "DRAFT_EMAIL")
    return createLocalDraft(tx, actor, args.resolvedConfig, args.effectKey, args.signal);
  if (args.node.type === "CREATE_CALENDAR_EVENT")
    return createLocalCalendarEvent(tx, actor, args.resolvedConfig, args.signal);
  if (args.node.type === "SEND_CHAT_MESSAGE")
    return createLocalChat(tx, actor, args.resolvedConfig, args.signal);
  return err("workflow_local_action_unsupported");
};

async function createLocalDraft(
  db: Db,
  actor: PermSetUser,
  raw: BlockOutput,
  effectKey: string,
  signal: AbortSignal,
): Promise<Result<BlockOutput, string>> {
  const input = resolvedBlockConfigSchemas.DRAFT_EMAIL.parse(raw);
  let bodyHtml = sanitizeAuthorHtml(input.bodyHtml);
  if (input.signatureId !== undefined) {
    const signature = await assertSignatureOwner(db, input.signatureId, actor.id, signal);
    if (!signature.ok) return err(signature.error.id);
    bodyHtml += sanitizeAuthorHtml(signature.value.bodyHtml);
  }
  const draft = await saveDraft(
    db,
    {
      actor,
      draft: {
        createId: z.uuid().parse(effectKey),
        accountId: input.accountId,
        threadId: input.threadId,
        subject: input.subject,
        bodyHtml,
        toEmails: input.to ?? [],
        ccEmails: input.cc ?? [],
        bccEmails: input.bcc ?? [],
        attachments: input.attachments,
        visibility: "private",
      },
    },
    signal,
  );
  return draft.ok
    ? ok({ draftId: draft.value.id, accountId: input.accountId, status: "draft", sent: false })
    : err(draft.error.id);
}

async function createLocalChat(
  db: Db,
  actor: PermSetUser,
  raw: BlockOutput,
  signal: AbortSignal,
): Promise<Result<BlockOutput, string>> {
  const input = resolvedBlockConfigSchemas.SEND_CHAT_MESSAGE.parse(raw);
  if (!(await localRecipientAvailable(db, input.recipientId, signal, true)))
    return err("workflow_chat_recipient_unavailable");
  const preference = await resolveDelivery(db, input.recipientId, "workflow_message", signal);
  if (!preference.inApp) return err("workflow_chat_delivery_disabled");
  const created = await createNotification(
    db,
    {
      type: "workflow_message",
      recipientId: input.recipientId,
      actorId: actor.id,
      entityType: null,
      entityId: null,
      payload: {
        title: input.title,
        message: input.message,
        approvalRequested: input.requireApproval === true,
      },
    },
    signal,
  );
  if (!created.ok) return err(created.error.id);
  if (!("notificationId" in created.value)) return err("workflow_chat_recipient_unavailable");
  return ok({
    notificationId: created.value.notificationId,
    recipientId: input.recipientId,
    delivered: true,
    channel: "in_app",
    approvalRequired: input.requireApproval ?? false,
  });
}

export function localWorkflowAction(type: string): boolean {
  return ["DRAFT_EMAIL", "CREATE_CALENDAR_EVENT", "SEND_CHAT_MESSAGE"].includes(type);
}
