import type { Locale } from "@/features/i18n/registry";
import type { AddDealState } from "./addDealState";
import type { NativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
import type { NativeDealAcknowledgement } from "./nativeCreateTypes";

interface RetainedBase {
  id: string;
  actorId: string;
  form: AddDealState;
  currency: string;
  valueLocale: Locale;
}
export type RetainedDealCreation = RetainedBase &
  (
    | {
        phase: "contact_pending" | "contact_unknown" | "contact_rejected";
        contact: "org" | "person";
      }
    | { phase: "submitting" | "unknown"; input: NativeDealCreateEnvelopeV1; uncertain: boolean }
    | {
        phase: "created";
        input: NativeDealCreateEnvelopeV1;
        deal: NativeDealAcknowledgement | null;
      }
  );
const retained = new Map<string, RetainedDealCreation>();
// Settled IDs prevent an older concurrent response from reviving an already resolved operation.
// Account+operation IDs only, scoped to this document lifetime.
const settled = new Set<string>();
const attempts = new Map<string, symbol>();
export interface CreationAttempt {
  readonly actorId: string;
  readonly token: symbol;
}
const listeners = new Set<() => void>();
function warnReload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
function emit() {
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", warnReload);
    if (retained.size > 0) window.addEventListener("beforeunload", warnReload);
  }
  for (const listener of listeners) listener();
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function readRetainedCreation(actorId: string | null): RetainedDealCreation | null {
  return actorId === null ? null : (retained.get(actorId) ?? null);
}
export function subscribeRetainedCreation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function retainCreation(operation: RetainedDealCreation): RetainedDealCreation {
  const existing = retained.get(operation.actorId);
  if (settled.has(`${operation.actorId}:${operation.id}`)) return existing ?? operation;
  if (existing !== undefined && existing.id !== operation.id) return existing;
  if (existing?.phase === "created") return existing;
  if (
    existing !== undefined &&
    "uncertain" in existing &&
    existing.uncertain &&
    "uncertain" in operation
  )
    operation = { ...operation, uncertain: true };
  const snapshot = freeze(structuredClone(operation));
  retained.set(operation.actorId, snapshot);
  emit();
  return snapshot;
}
export function creationAttemptHeld(actorId: string | null): boolean {
  return actorId !== null && attempts.has(actorId);
}
export function claimCreationAttempt(actorId: string): CreationAttempt | null {
  if (attempts.has(actorId)) return null;
  const token = Symbol("native-deal-attempt");
  attempts.set(actorId, token);
  emit();
  return { actorId, token };
}
export function releaseCreationAttempt(attempt: CreationAttempt) {
  if (attempts.get(attempt.actorId) !== attempt.token) return;
  attempts.delete(attempt.actorId);
  emit();
}
export function settleRejectedCreation(actorId: string, id: string): boolean {
  const current = retained.get(actorId);
  if (
    current?.id !== id ||
    current.phase === "created" ||
    ("uncertain" in current && current.uncertain)
  )
    return false;
  clearRetainedCreation(actorId, id);
  return true;
}
export function clearRetainedCreation(actorId: string, id: string) {
  if (retained.get(actorId)?.id !== id) return;
  settled.add(`${actorId}:${id}`);
  retained.delete(actorId);
  emit();
}
