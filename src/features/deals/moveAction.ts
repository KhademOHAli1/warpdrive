"use server";

import { after } from "next/server";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { moveDeal } from "./dealActions";
import { type DealActionSnapshot, dealActionSnapshot } from "./dealVersion";
import { notifyOnDealMove } from "./notifyHelpers";
import type { DealMoveInput } from "./schemas";

export type MoveResult =
  | { ok: true; deal: DealActionSnapshot }
  | { ok: false; error: { id: string } };

// CSRF-guarded deal move action.
// guardCsrf is called FIRST: no DB work happens before CSRF is verified.
// Native session identity stays server-private; client identity is never trusted.
export async function moveDealAction(
  input: DealMoveInput,
  csrfToken: string | null = null,
): Promise<MoveResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };

  const { actor, session } = await createContext();
  if (actor === null || session === null || actor.id !== session.userId)
    return { ok: false, error: { id: "E_AUTH_003" } };

  const result = await moveDeal(db, actor, input, SIG(), session);
  if (!result.ok) return { ok: false, error: { id: result.error.id } };

  // Deferred past the response: the fan-out is outside the deal transaction and invisible to the
  // caller. Never let it throw in after(); the user cannot act on a failure there.
  const moved = result.value;
  after(async () => {
    try {
      await notifyOnDealMove(db, { deal: moved, actorId: actor.id, signal: SIG() });
    } catch (err: unknown) {
      console.warn("moveDealAction: notifyOnDealMove failed (deferred)", { err });
    }
  });

  return {
    ok: true,
    deal: dealActionSnapshot(result.value),
  };
}
