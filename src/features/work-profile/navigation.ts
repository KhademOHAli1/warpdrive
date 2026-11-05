import type { Db } from "@/db/client";
import { allowed, type WorkActor } from "./policy";
import { readProfile } from "./read";
/** Member-safe navigation hints; every linked feature still enforces its own permission gates. */
export async function readWorkNavigation(db: Db, actor: WorkActor, signal: AbortSignal) {
  const profile = await readProfile(db, signal);
  return {
    modules: profile.preferences.modules,
    canViewWork: allowed(actor, "work.view"),
  };
}
