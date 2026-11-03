import type { NativeStageMoveInput } from "./nativeStageTypes";

export type StageMovePhase =
  | "pending"
  | "unknown"
  | "confirmed"
  | "conflict"
  | "denied"
  | "invalid"
  | "unavailable";
export interface RetainedStageMove {
  id: string;
  input: NativeStageMoveInput;
  phase: StageMovePhase;
}
// Account partitioned and document scoped. A hard reload loads current state, not a receipt.
// No automatic retries, storage of credentials or cross-account cache restoration.
const moves = new Map<string, RetainedStageMove>();
const readers = new Map<string, symbol>();
const listeners = new Set<() => void>();
function warnUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
function emit() {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", warnUnload);
    if (moves.size > 0) window.addEventListener("beforeunload", warnUnload);
  }
  for (const listener of listeners) listener();
}
export function subscribeStageMove(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function readStageMove(actorId: string | null) {
  return actorId === null ? null : (moves.get(actorId) ?? null);
}
export function stageReadHeld(actorId: string | null) {
  return actorId !== null && readers.has(actorId);
}
export function beginStageMove(input: NativeStageMoveInput): RetainedStageMove | null {
  if (moves.has(input.expectedActorId) || readers.has(input.expectedActorId)) return null;
  const move: RetainedStageMove = Object.freeze({
    id: crypto.randomUUID(),
    input: Object.freeze({ ...input }),
    phase: "pending",
  });
  moves.set(input.expectedActorId, move);
  emit();
  return move;
}
export function settleStageMove(actorId: string, id: string, phase: StageMovePhase) {
  const move = moves.get(actorId);
  if (move?.id !== id) return;
  moves.set(actorId, Object.freeze({ ...move, phase }));
  emit();
}
export function clearStageMove(actorId: string, id: string) {
  if (moves.get(actorId)?.id !== id) return;
  moves.delete(actorId);
  emit();
}
export function claimStageRead(actorId: string): symbol | null {
  if (readers.has(actorId) || moves.get(actorId)?.phase === "pending") return null;
  const token = Symbol("stage-current-state-read");
  readers.set(actorId, token);
  emit();
  return token;
}
export function releaseStageRead(actorId: string, token: symbol) {
  if (readers.get(actorId) !== token) return;
  readers.delete(actorId);
  emit();
}
