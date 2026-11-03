import type { ActionResult } from "@/types/actionResult";
import type { ReadActionValue, ReadIntentPreparation, ReadIntentReceipt } from "./readIntentTypes";

export type ReadInput = { threadId: string; operationId: string };
export const READ_OPERATION_ID = "00000000-0000-4000-8000-000000000001";
export const UNREAD_OPERATION_ID = "00000000-0000-4000-8000-000000000002";

export function readIntentReceipt(
  threadId: string,
  desiredRead: boolean,
  state: ReadIntentReceipt["state"] = "applied",
  operationId = desiredRead ? READ_OPERATION_ID : UNREAD_OPERATION_ID,
): ReadIntentReceipt {
  return { operationId, threadId, desiredRead, state, admitBefore: "2099-01-01T00:00:00.000Z" };
}

export function prepareCreatedReadIntent(input: {
  threadId: string;
  read: boolean;
}): Promise<ActionResult<ReadIntentPreparation>> {
  return Promise.resolve({
    ok: true,
    value: {
      kind: "created",
      readIntent: readIntentReceipt(input.threadId, input.read, "prepared"),
    },
  });
}

function applyReadAction(
  input: ReadInput,
  desiredRead: boolean,
): Promise<ActionResult<ReadActionValue>> {
  return Promise.resolve({
    ok: true,
    value: {
      threadId: input.threadId,
      readIntent: readIntentReceipt(input.threadId, desiredRead, "applied", input.operationId),
    },
  });
}

export function applyReadIntent(input: ReadInput): Promise<ActionResult<ReadActionValue>> {
  return applyReadAction(input, true);
}

export function applyUnreadIntent(input: ReadInput): Promise<ActionResult<ReadActionValue>> {
  return applyReadAction(input, false);
}

export function reconcileAppliedReadIntent(
  input: ReadInput,
): Promise<ActionResult<ReadIntentReceipt>> {
  return Promise.resolve({
    ok: true,
    value: readIntentReceipt(
      input.threadId,
      input.operationId === READ_OPERATION_ID,
      "applied",
      input.operationId,
    ),
  });
}
