"use client";

import { ERROR_IDS } from "@/constants/errorIds";
import type { RouterOutputs } from "@/lib/trpc-client";
import type { ActionResult } from "@/types/actionResult";
import { readCsrfToken } from "@/utils/csrfCookie";
import { markThreadReadAction, markThreadUnreadAction } from "./readActions";
import {
  prepareThreadReadIntentAction,
  reconcileThreadReadIntentAction,
} from "./readIntentActions";
import type { ReadActionValue, ReadIntentReceipt } from "./readIntentTypes";

type FreshThread = RouterOutputs["email"]["thread"]["get"];
const READ_RECEIPT_MS = 10_000;

export interface PendingReadIntent {
  receipt: ReadIntentReceipt;
  owned: boolean;
}

export type ReadIntentOutcome =
  | { kind: "applied" | "uncertain"; intent: PendingReadIntent }
  | { kind: "failed" | "obsolete" };

async function settleReadReceipt<Value>(
  action: () => Promise<ActionResult<Value>>,
): Promise<ActionResult<Value>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Observe the underlying action after the UI deadline without replaying it.
    return await Promise.race([
      action(),
      new Promise<ActionResult<Value>>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: { id: ERROR_IDS.DB_WRITE_FAILED } }),
          READ_RECEIPT_MS,
        );
      }),
    ]);
  } catch {
    return { ok: false, error: { id: ERROR_IDS.DB_WRITE_FAILED } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function matchesIntent(receipt: ReadIntentReceipt | undefined, expected: ReadIntentReceipt) {
  return (
    receipt !== undefined &&
    receipt.operationId === expected.operationId &&
    receipt.threadId === expected.threadId &&
    receipt.desiredRead === expected.desiredRead
  );
}

function uncertainError(result: ActionResult<ReadActionValue>) {
  return (
    !result.ok &&
    (result.error.id === ERROR_IDS.DB_WRITE_FAILED ||
      result.error.id === ERROR_IDS.MAIL_WRITE_UNKNOWN ||
      result.error.id === ERROR_IDS.MAIL_WRITE_PARTIAL)
  );
}

export async function runThreadReadIntent(
  threadId: string,
  desiredRead: boolean,
  mayExecute: () => boolean,
): Promise<ReadIntentOutcome> {
  const prepared = await settleReadReceipt(() =>
    prepareThreadReadIntentAction(readCsrfToken(), { threadId, read: desiredRead }),
  );
  // Preparation changes no mail, so a lost preparation reply is not a lost write.
  if (!prepared.ok || prepared.value.readIntent.threadId !== threadId) return { kind: "failed" };
  const receipt = prepared.value.readIntent;
  const intent = { receipt, owned: prepared.value.kind === "created" };
  if (prepared.value.kind === "blocked") return { kind: "uncertain", intent };
  if (!mayExecute()) return { kind: "obsolete" };
  if (receipt.state !== "prepared" || receipt.desiredRead !== desiredRead)
    return { kind: "uncertain", intent: { ...intent, owned: false } };
  const action = desiredRead ? markThreadReadAction : markThreadUnreadAction;
  const result = await settleReadReceipt<ReadActionValue>(() =>
    action(readCsrfToken(), { threadId, operationId: receipt.operationId }),
  );
  if (
    result.ok &&
    result.value.threadId === threadId &&
    matchesIntent(result.value.readIntent, receipt) &&
    result.value.readIntent?.state === "applied"
  )
    return { kind: "applied", intent };
  if (result.ok || uncertainError(result)) return { kind: "uncertain", intent };
  return { kind: "failed" };
}

export interface ReadIntentRecovery {
  receipt: ReadIntentReceipt;
  data: FreshThread;
}

export async function refreshThreadReadIntent(
  intent: PendingReadIntent,
  readFresh: (signal: AbortSignal) => Promise<FreshThread>,
  controller: AbortController,
): Promise<ReadIntentRecovery | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => undefined;
  const interrupted = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => controller.abort(), READ_RECEIPT_MS);
  });
  const read = async (): Promise<ReadIntentRecovery | undefined> => {
    if (controller.signal.aborted) return undefined;
    const result = await reconcileThreadReadIntentAction(readCsrfToken(), {
      threadId: intent.receipt.threadId,
      operationId: intent.receipt.operationId,
    });
    controller.signal.throwIfAborted();
    if (!result.ok || !matchesIntent(result.value, intent.receipt)) return undefined;
    const data = await readFresh(controller.signal);
    controller.signal.throwIfAborted();
    if (data.thread.id !== intent.receipt.threadId) return undefined;
    return { receipt: result.value, data };
  };
  try {
    // Cancellation stops UI waiting; a late status response cannot start a fresh GET.
    return await Promise.race([read(), interrupted]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
