import type { Db } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { recordSecurityEvent } from "@/features/auth/management/audit";
import { enqueueUserSecurityNotice } from "@/features/auth/management/notices";

type AuditTarget =
  | "permission_set"
  | "visibility_group"
  | "pipeline"
  | "user"
  | "settings"
  | "deal"
  | "person"
  | "organization";

export interface AuditEventInput {
  actorId: string | null;
  targetType: AuditTarget;
  targetId: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  correlationId?: string | null;
}

// Writes one security-relevant change to audit_events (permissions spec 9).
export async function recordAudit(
  db: Db,
  event: AuditEventInput,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await db.insert(auditEvents).values({
    actorId: event.actorId,
    targetType: event.targetType,
    targetId: event.targetId,
    action: event.action,
    before: event.before ?? null,
    after: event.after ?? null,
    correlationId: event.correlationId ?? null,
  });
  const userChange =
    event.targetType === "user" &&
    ["user.set_admin", "user.assign_permission_set", "user.deactivate", "user.activate"].includes(
      event.action,
    );
  if (
    userChange ||
    event.targetType === "permission_set" ||
    event.targetType === "visibility_group"
  ) {
    // Legacy before/after objects may contain authored names or private values, so never mirror them.
    await recordSecurityEvent(
      db,
      {
        actorId: event.actorId,
        targetUserId: userChange ? event.targetId : null,
        action: event.action,
        outcome: "success",
        metadata: { changed: true },
      },
      signal,
    );
    if (userChange && event.targetId !== null)
      await enqueueUserSecurityNotice(db, event.targetId, "admin_access", signal);
  }
  signal.throwIfAborted();
}
