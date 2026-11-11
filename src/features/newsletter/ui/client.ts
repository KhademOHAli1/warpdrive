"use client";

import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { NewsletterReceiptResolution, NewsletterReceiptView } from "../operationReceipts";
import { needsNewsletterReceipt } from "../operationReceiptsPolicy";

type Input = Record<string, unknown>;

const pendingChanged = "warpdrive:newsletter:pending:changed";
const campaignStatusValues = new Set(["draft", "scheduled", "running", "paused", "cancelled"]);
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function pendingPrefix(actorId: string): string {
  return `warpdrive:newsletter:pending:v1:${actorId}:`;
}

function pendingScope(operation: string, { id, status, deliveryId }: Input): string {
  if (
    operation === "delivery.resolve" &&
    typeof deliveryId === "string" &&
    uuidPattern.test(deliveryId)
  ) {
    return `${operation}:${deliveryId}`;
  }
  if (
    operation === "campaigns.status" &&
    typeof id === "number" &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    typeof status === "string" &&
    campaignStatusValues.has(status)
  ) {
    return `${operation}:${id}:${status}`;
  }
  return operation;
}

function pendingKey(actorId: string, operation: string): string {
  return `${pendingPrefix(actorId)}${operation}`;
}

function savedOperationId(key: string): string | null | undefined {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return undefined;
  }
}

function saveOperationId(key: string, operationId: string | null): void {
  try {
    if (operationId === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, operationId);
    window.dispatchEvent(new Event(pendingChanged));
  } catch {
    // The mounted intent survives if the browser disables tab storage.
  }
}

function pendingEntries(actorId: string): [string, string][] {
  const prefix = pendingPrefix(actorId);
  try {
    const entries: [string, string][] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const id = sessionStorage.getItem(key);
      if (id !== null && uuidPattern.test(id)) entries.push([key, id]);
    }
    return entries;
  } catch {
    return [];
  }
}

function acknowledgeReceipt(actorId: string, receipt: NewsletterReceiptView): void {
  const operationKey = pendingKey(actorId, receipt.operation);
  for (const [key, id] of pendingEntries(actorId)) {
    if (
      id === receipt.operationId &&
      (key === operationKey || key.startsWith(`${operationKey}:`))
    ) {
      saveOperationId(key, null);
    }
  }
}

function readPendingIds(actorId: string | null): string {
  if (actorId === null) return "";
  const ids = new Set(pendingEntries(actorId).map(([, id]) => id));
  return [...ids].sort().join(",");
}

function subscribePending(listener: () => void): () => void {
  window.addEventListener(pendingChanged, listener);
  return () => window.removeEventListener(pendingChanged, listener);
}

const emptyPending = () => "";

export function usePendingNewsletterReceiptIds(): string[] {
  const { actorId } = useNativeActor();
  const read = useCallback(() => readPendingIds(actorId), [actorId]);
  const snapshot = useSyncExternalStore(subscribePending, read, emptyPending);
  return snapshot === "" ? [] : snapshot.split(",");
}

function rejectedInput(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const data = error.data as { code?: unknown } | undefined;
  return data?.code === "BAD_REQUEST";
}

export function useNewsletterRead<T>(
  operation: string,
  input: Input = {},
  enabled = true,
  refetchInterval?: number,
) {
  const query = trpc.newsletter.read.useQuery(
    { operation, input },
    { enabled, retry: false, refetchInterval },
  );
  return { ...query, data: query.data as T | undefined };
}

export function useNewsletterReceipt(operationId: string | null) {
  const { actorId } = useNativeActor();
  const query = trpc.newsletter.receipt.useQuery(
    { operationId: operationId ?? "" },
    { enabled: operationId !== null, retry: false },
  );
  const receipt = query.data;
  useEffect(() => {
    if (
      actorId === null ||
      operationId === null ||
      receipt?.operationId !== operationId.toLowerCase()
    )
      return;
    if (receipt.state === "succeeded" || receipt.state === "failed" || receipt.resolution) {
      acknowledgeReceipt(actorId, receipt);
    }
  }, [actorId, operationId, receipt]);
  return query;
}

export function useNewsletterReceiptResolution() {
  const actor = useNativeActor();
  const utils = trpc.useUtils();
  const mutation = trpc.newsletter.resolveReceipt.useMutation({ retry: false });

  async function run(operationId: string, resolution: NewsletterReceiptResolution) {
    const receipt = await mutation.mutateAsync({
      operationId,
      ...resolution,
      csrfToken: readCsrfToken(),
    });
    if (actor.actorId !== null && actor.isCurrent()) {
      acknowledgeReceipt(actor.actorId, receipt);
    }
    void utils.newsletter.receipt.invalidate({ operationId });
    void utils.newsletter.read.invalidate();
    return receipt;
  }

  return { run, isPending: mutation.isPending, error: mutation.error };
}

export function useNewsletterWrite<T = unknown>() {
  const actor = useNativeActor();
  const fallback = useRef(new Map<string, string>());
  const utils = trpc.useUtils();
  const mutation = trpc.newsletter.write.useMutation({
    retry: false,
    onSettled: () => {
      void utils.newsletter.read.invalidate();
    },
  });

  function pendingOperationId(operation: string, input: Input = {}): string | null {
    if (actor.actorId === null) return null;
    const key = pendingKey(actor.actorId, pendingScope(operation, input));
    const stored = savedOperationId(key);
    return stored === undefined ? (fallback.current.get(key) ?? null) : stored;
  }

  function clearPending(operation: string, input: Input, id: string): void {
    if (actor.actorId === null || pendingOperationId(operation, input) !== id) return;
    const key = pendingKey(actor.actorId, pendingScope(operation, input));
    fallback.current.delete(key);
    saveOperationId(key, null);
  }

  async function run(
    operation: string,
    input: Input = {},
    explicitOperationId?: string,
  ): Promise<T> {
    const durable = needsNewsletterReceipt(operation);
    const existing = durable ? pendingOperationId(operation, input) : null;
    const operationId = durable
      ? (explicitOperationId ?? existing ?? crypto.randomUUID())
      : undefined;
    if (operationId !== undefined && actor.actorId !== null && explicitOperationId === undefined) {
      const key = pendingKey(actor.actorId, pendingScope(operation, input));
      fallback.current.set(key, operationId);
      // Store only the opaque ID under the actor/operation scope. The server binds the payload.
      saveOperationId(key, operationId);
    }
    try {
      const result = await mutation.mutateAsync({
        operation,
        input,
        operationId,
        csrfToken: readCsrfToken(),
      });
      if (operationId !== undefined) clearPending(operation, input, operationId);
      return result as T;
    } catch (error) {
      if (operationId !== undefined && actor.isCurrent()) {
        const receipt = await utils.newsletter.receipt
          .fetch({ operationId }, { retry: false })
          .catch(() => undefined);
        // A lost success, an unknown effect, and a mismatched intent all keep their original
        // UUID. The next submit can only replay it or surface the same unresolved receipt.
        if (
          actor.isCurrent() &&
          (receipt?.state === "failed" ||
            receipt?.resolution?.reviewedAt !== undefined ||
            (receipt === null && existing === null && rejectedInput(error)))
        ) {
          clearPending(operation, input, operationId);
        }
      }
      throw error;
    }
  }

  return {
    run,
    pendingOperationId,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
