import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";

/** Use live authority within the caller's snapshot, capped by the authenticated request. */
export async function hydrateReportActor(tx: Db, request: PermSetUser, signal: AbortSignal) {
  if (!request.isActive) return null;
  const live = await hydrateActor(tx, request.id, signal);
  if (live === null || request.type === "admin") return live;
  return {
    id: live.id,
    type: "regular",
    isActive: true,
    groupIds: new Set([...request.groupIds].filter((id) => live.groupIds.has(id))),
    managedUserIds: new Set(
      [...(request.managedUserIds ?? [])].filter((id) => live.managedUserIds?.has(id) === true),
    ),
    flags: new Set(
      [...request.flags].filter((flag) => live.type === "admin" || live.flags.has(flag)),
    ),
  } satisfies PermSetUser;
}
