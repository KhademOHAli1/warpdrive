"use server";

import { after } from "next/server";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { moveNativeDealStage, readNativeDealStage } from "./nativeStage";
import type { NativeStageMoveResult, NativeStageReadResult } from "./nativeStageTypes";
import { notifyOnDealMove } from "./notifyHelpers";

export async function moveNativeDealStageAction(
  raw: unknown,
  csrfToken: string | null,
): Promise<NativeStageMoveResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, reason: "denied", errorId: "E_AUTH_CSRF" };
  const context = await createContext();
  if (context.session === null || context.actor === null)
    return { ok: false, reason: "denied", errorId: "E_AUTH_003" };
  const who = context.session;
  const result = await moveNativeDealStage(db, who, raw, SIG());
  if (result.ok)
    after(async () => {
      try {
        await notifyOnDealMove(db, { deal: result.deal, actorId: who.userId, signal: SIG() });
      } catch {
        console.warn("moveNativeDealStageAction: deferred notification failed");
      }
    });
  return result;
}

export async function readNativeDealStageAction(
  raw: unknown,
  csrfToken: string | null,
): Promise<NativeStageReadResult> {
  const csrf = await guardCsrf(csrfToken);
  if (!csrf.ok) return { ok: false, reason: "denied", errorId: "E_AUTH_CSRF" };
  const context = await createContext();
  if (context.session === null || context.actor === null)
    return { ok: false, reason: "denied", errorId: "E_AUTH_003" };
  return readNativeDealStage(db, context.session, raw, SIG());
}
