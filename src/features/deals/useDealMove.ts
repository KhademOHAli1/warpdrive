"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { moveNativeDealStageAction, readNativeDealStageAction } from "./nativeStageAction";
import { type NativeStageMoveInput, nativeStageMoveInput } from "./nativeStageTypes";
import {
  beginStageMove,
  claimStageRead,
  clearStageMove,
  readStageMove,
  releaseStageRead,
  settleStageMove,
  stageReadHeld,
  subscribeStageMove,
} from "./retainedStageMove";

export const BOARD_QUERY_KEY = (pipelineId: string) => ["board", pipelineId] as const;
type MoveInput = Omit<NativeStageMoveInput, "protocolVersion" | "expectedActorId" | "pipelineId">;
export function useDealMove(pipelineId: string, reloadBoard?: () => Promise<unknown>) {
  const client = useQueryClient();
  const { actorId, isCurrent } = useNativeActor();
  const state = useSyncExternalStore(
    subscribeStageMove,
    () => readStageMove(actorId),
    () => null,
  );
  const reading = useSyncExternalStore(
    subscribeStageMove,
    () => stageReadHeld(actorId),
    () => false,
  );
  const [notice, setNotice] = useState<
    "moved" | "current" | "unavailable" | "invalid" | "readFailed" | null
  >(null);
  async function refreshBoard() {
    if (reloadBoard !== undefined) await reloadBoard();
    else
      await client.invalidateQueries(
        { queryKey: BOARD_QUERY_KEY(pipelineId) },
        { throwOnError: true },
      );
  }
  async function dispatch(input: MoveInput) {
    if (
      actorId === null ||
      !isCurrent() ||
      readStageMove(actorId) !== null ||
      stageReadHeld(actorId)
    )
      return;
    const parsed = nativeStageMoveInput.safeParse({
      ...input,
      protocolVersion: 1,
      expectedActorId: actorId,
      pipelineId,
    });
    if (!parsed.success) {
      setNotice("invalid");
      return;
    }
    const saved = beginStageMove(parsed.data);
    if (saved === null) return;
    setNotice(null);
    let acknowledged = false;
    try {
      const result = await moveNativeDealStageAction(saved.input, readCsrfToken());
      if (!result.ok) {
        settleStageMove(actorId, saved.id, result.reason);
        return;
      }
      if (
        result.deal.id !== saved.input.dealId ||
        result.deal.pipelineId !== saved.input.pipelineId ||
        result.deal.stageId !== saved.input.toStageId
      ) {
        settleStageMove(actorId, saved.id, "unknown");
        return;
      }
      acknowledged = true;
      settleStageMove(actorId, saved.id, "confirmed");
      if (!isCurrent()) return;
      const token = claimStageRead(actorId);
      if (token === null) return;
      try {
        await refreshBoard();
      } finally {
        releaseStageRead(actorId, token);
      }
      if (!isCurrent()) return;
      clearStageMove(actorId, saved.id);
      setNotice("moved");
    } catch {
      // No stale snapshot restoration. An exception may follow a successful COMMIT.
      settleStageMove(actorId, saved.id, acknowledged ? "confirmed" : "unknown");
    }
  }
  async function loadCurrentState() {
    if (actorId === null || !isCurrent()) return;
    const saved = readStageMove(actorId);
    const token = claimStageRead(actorId);
    if (token === null) return;
    setNotice(null);
    try {
      // This entry is strictly read-only, including a missing/hidden/deleted deal.
      const result =
        saved === null
          ? null
          : await readNativeDealStageAction(
              {
                protocolVersion: 1,
                expectedActorId: actorId,
                dealId: saved.input.dealId,
              },
              readCsrfToken(),
            );
      if (!isCurrent()) return;
      if (result !== null && !result.ok) {
        setNotice("readFailed");
        return;
      }
      await refreshBoard();
      if (!isCurrent()) return;
      if (saved !== null) clearStageMove(actorId, saved.id);
      setNotice(result?.ok && result.deal === null ? "unavailable" : "current");
    } catch {
      if (isCurrent()) setNotice("readFailed");
    } finally {
      releaseStageRead(actorId, token);
    }
  }
  return {
    move: (input: MoveInput) => {
      void dispatch(input);
    },
    state,
    notice,
    blocked: state !== null || reading || actorId === null,
    busy: state?.phase === "pending" || reading,
    loadCurrentState,
  };
}
