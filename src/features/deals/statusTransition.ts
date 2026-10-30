import type { deals } from "@/db/schema/deals";

export type DealPatch = Partial<typeof deals.$inferInsert>;

export function applyStatusTransition(
  patch: DealPatch,
  status: "open" | "won" | "lost",
  lostReason: string | undefined,
  now: Date,
): void {
  patch.status = status;
  if (status === "won") {
    patch.wonTime = now;
    patch.lostTime = null;
    patch.lostReason = null;
  } else if (status === "lost") {
    patch.lostTime = now;
    patch.lostReason =
      lostReason !== undefined && lostReason.trim() !== "" ? lostReason.trim() : null;
    patch.wonTime = null;
  } else {
    patch.wonTime = null;
    patch.lostTime = null;
    patch.lostReason = null;
  }
}
