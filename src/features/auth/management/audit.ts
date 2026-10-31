import type { Db } from "@/db/client";
import { authSecurityEvents } from "@/db/schema/authManagement";
import { redactSecurityMetadata } from "./domain";

export interface SecurityEvent {
  actorId?: string | null;
  targetUserId?: string | null;
  action: string;
  outcome: "success" | "denied" | "failure";
  metadata?: Record<string, unknown>;
}

export async function recordSecurityEvent(
  db: Db,
  event: SecurityEvent,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await db.insert(authSecurityEvents).values({
    actorId: event.actorId ?? null,
    targetUserId: event.targetUserId ?? null,
    action: event.action,
    outcome: event.outcome,
    metadata: redactSecurityMetadata(event.metadata ?? {}),
  });
  signal.throwIfAborted();
}
