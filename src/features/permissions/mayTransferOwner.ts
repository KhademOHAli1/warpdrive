interface OwnerTransferActor {
  id: string;
  type: "admin" | "regular";
  flags: ReadonlySet<string>;
}

export function mayTransferOwner(
  actor: OwnerTransferActor,
  currentOwnerId: string | null,
): boolean {
  if (actor.type === "admin") return true;
  if (actor.flags.has("deal.changeOwner_any")) return true;
  return actor.flags.has("deal.changeOwner_own") && currentOwnerId === actor.id;
}

interface FlagMapSession {
  userId: string;
  isAdmin: boolean;
  flags: Record<string, boolean>;
}

export function toTransferActor(session: FlagMapSession): OwnerTransferActor {
  return {
    id: session.userId,
    type: session.isAdmin ? "admin" : "regular",
    flags: new Set(Object.keys(session.flags).filter((k) => session.flags[k] === true)),
  };
}
