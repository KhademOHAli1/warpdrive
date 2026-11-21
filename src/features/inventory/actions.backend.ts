import { z } from "zod";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import type { InventoryResult } from "./contracts";
import { inventoryUnavailable } from "./errors";
import { runInventoryCommand } from "./service";

export async function executeInventoryAction(
  expectedActorId: string,
  command: unknown,
  rawDealId: string | null,
  csrf: string | null,
): Promise<InventoryResult> {
  if (typeof csrf !== "string" || !(await guardCsrf(csrf)).ok) {
    return { ok: false, error: inventoryUnavailable };
  }
  const deal = z.uuid().toLowerCase().nullable().safeParse(rawDealId);
  if (!deal.success) return { ok: false, error: inventoryUnavailable };
  const { actor, session } = await createContext();
  if (actor === null || session === null || actor.id !== expectedActorId) {
    return { ok: false, error: inventoryUnavailable };
  }
  return runInventoryCommand(db, session, command, deal.data, AbortSignal.timeout(15_000));
}
