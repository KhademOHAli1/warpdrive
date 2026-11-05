import { z } from "zod";
import type { Db } from "@/db/client";
import { resolveBlockConfig } from "@/features/blocks/bindings";
import type { BlockJson, BlockReadiness, WorkflowV2Node } from "@/features/blocks/contracts";
import { resolvedBlockConfigSchemas } from "@/features/blocks/schemas";
import { assertMailboxOwner, assertSignatureOwner } from "@/features/email/mailboxOwnership";
import { resolveDelivery } from "@/features/notifications/preferences";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { localRecipientAvailable, localWorkflowActor } from "./localAuthority";
import {
  localCalendarNeedsProvider,
  localCalendarType,
  localCalendarZoneValid,
} from "./localCalendar";

const ready: BlockReadiness = { state: "ready" };
const needs = (reason: string): BlockReadiness => ({ state: "needs_configuration", reason });
function literal(value: BlockJson | undefined): BlockJson | undefined {
  if (value === undefined) return undefined;
  const result = resolveBlockConfig({ value }, {}, [], {});
  return result.ok ? result.value.value : undefined;
}

async function draftReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  if (node.config.accountId === undefined) return needs("workflow_draft_mailbox_required");
  const account = literal(node.config.accountId);
  if (account !== undefined) {
    const id = z.uuid().safeParse(account);
    if (!id.success || !(await assertMailboxOwner(db, id.data, actor.id, signal)).ok)
      return { state: "needs_connection", reason: "workflow_draft_mailbox_unavailable" };
  }
  const signature = literal(node.config.signatureId);
  if (signature !== undefined) {
    const id = z.uuid().safeParse(signature);
    if (!id.success || !(await assertSignatureOwner(db, id.data, actor.id, signal)).ok)
      return { state: "forbidden", reason: "workflow_draft_signature_unavailable" };
  }
  return ready;
}

function calendarConfiguration(node: WorkflowV2Node): BlockReadiness | null {
  const resolved = resolveBlockConfig(node.config, {}, [], {});
  if (resolved.ok) {
    const input = resolvedBlockConfigSchemas.CREATE_CALENDAR_EVENT.parse(resolved.value);
    if (input.title.length > 255) return needs("workflow_calendar_title_invalid");
    if (localCalendarNeedsProvider(input))
      return { state: "needs_connection", reason: "workflow_calendar_provider_unavailable" };
    if (Date.parse(input.endsAt) < Date.parse(input.startsAt))
      return needs("workflow_calendar_dates_invalid");
    if (!localCalendarZoneValid(input.timeZone)) return needs("workflow_calendar_zone_invalid");
  }
  return null;
}

async function calendarReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  if (!can(actor, "activity.create")) return { state: "forbidden", reason: "E_PERM_001" };
  const issue = calendarConfiguration(node);
  if (issue !== null) return issue;
  const type = literal(node.config.typeId);
  if (type !== undefined && typeof type !== "string")
    return needs("workflow_calendar_type_unavailable");
  if ((await localCalendarType(db, typeof type === "string" ? type : undefined, signal)) === null)
    return needs("workflow_calendar_type_unavailable");
  const assignee = literal(node.config.assigneeId);
  if (
    assignee !== undefined &&
    (typeof assignee !== "string" || !(await localRecipientAvailable(db, assignee, signal, false)))
  )
    return { state: "forbidden", reason: "workflow_calendar_assignee_unavailable" };
  return ready;
}

export async function localWorkflowReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  const current = await localWorkflowActor(db, actor.id, signal, false);
  if (current === null) return { state: "forbidden", reason: "E_PERM_001" };
  try {
    const resolved = resolveBlockConfig(node.config, {}, [], {});
    if (node.type === "DRAFT_EMAIL") {
      if (resolved.ok) resolvedBlockConfigSchemas.DRAFT_EMAIL.parse(resolved.value);
      return await draftReadiness(db, current, node, signal);
    }
    if (node.type === "CREATE_CALENDAR_EVENT")
      return await calendarReadiness(db, current, node, signal);
    if (node.type !== "SEND_CHAT_MESSAGE") return { state: "unsupported_in_context" };
    if (resolved.ok) resolvedBlockConfigSchemas.SEND_CHAT_MESSAGE.parse(resolved.value);
    const recipient = literal(node.config.recipientId);
    if (node.config.recipientId === undefined) return needs("workflow_chat_recipient_required");
    const id = z.uuid().safeParse(recipient);
    if (recipient === undefined) return ready;
    if (!id.success || !(await localRecipientAvailable(db, id.data, signal, false)))
      return { state: "forbidden", reason: "workflow_chat_recipient_unavailable" };
    const preference = await resolveDelivery(db, id.data, "workflow_message", signal);
    return preference.inApp
      ? ready
      : { state: "forbidden", reason: "workflow_chat_delivery_disabled" };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return needs("workflow_local_configuration_invalid");
  }
}
