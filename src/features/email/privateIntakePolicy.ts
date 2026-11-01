import type { PrivateIntakeSummary } from "./privateIntakeTypes";
import type { InboxThread } from "./threadShape";

export function isProtectedPrivateIntake(
  summary: PrivateIntakeSummary | null | undefined,
): boolean {
  return summary != null && summary.state !== "confirmed_notification";
}

export function canMarkThreadRead(
  thread: Pick<InboxThread, "mailCapabilities" | "privateIntake" | "isOwner">,
): boolean {
  if (isProtectedPrivateIntake(thread.privateIntake))
    return thread.isOwner && thread.mailCapabilities?.localRead === true;
  return thread.mailCapabilities?.markRead !== false;
}

// Client affordances only. Every mutation retains its current server-side authority checks.
export function canApplySelectedMailAction(
  threads: readonly InboxThread[],
  selected: ReadonlySet<string>,
  action: "archive" | "markRead",
): boolean {
  if (selected.size === 0) return false;
  const rows = new Map(threads.map((thread) => [thread.id, thread]));
  return [...selected].every((id) => {
    const thread = rows.get(id);
    return (
      thread !== undefined &&
      (action === "archive"
        ? !isProtectedPrivateIntake(thread.privateIntake)
        : canMarkThreadRead(thread))
    );
  });
}
