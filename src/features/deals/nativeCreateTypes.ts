export interface NativeDealAcknowledgement {
  id: string;
  updatedAt: string;
  writeVersion: string;
}
export type NativeDealCreateFailure = {
  ok: false;
  error: { id: string };
  // Only a protected receipt miss plus transaction rollback can establish not_created.
  outcome: "not_created" | "unresolved";
};
export type NativeDealCreateResult =
  | { ok: true; deal: NativeDealAcknowledgement | null; replayed: boolean }
  | NativeDealCreateFailure;
