import { eq, sql } from "drizzle-orm";
import { notifications } from "@/db/schema";
import type { NotificationSendPurpose } from "@/features/email/mailSendPurpose";
import { canActorAccessParent } from "@/features/files/fileAuthz";
import { hydrateActor } from "@/server/hydrateActor";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { resolveDelivery } from "../preferences";
import type {
  NotificationAdmissionAuthority,
  NotificationAdmissionPolicy,
} from "./notificationAdmissionTypes";

export async function notificationSubmissionPolicy(
  tx: DbOrTx,
  purpose: NotificationSendPurpose,
  authority: NotificationAdmissionAuthority,
  signal: AbortSignal,
): Promise<NotificationAdmissionPolicy> {
  // Row-only checks miss first preference inserts and relationship deletion/reparenting.
  // NOWAIT defers instead of holding owner locks while a policy writer waits on us.
  await tx.execute(sql`LOCK TABLE notification_preferences,permission_sets,
    visibility_group_members,teams,team_members,pipelines,deals,persons,organizations,
    activities,activity_participants,email_messages,email_threads,email_accounts
    IN SHARE MODE NOWAIT`);
  signal.throwIfAborted();
  const [notice] = await tx
    .select()
    .from(notifications)
    .where(eq(notifications.id, purpose.notificationId))
    .limit(1)
    .for("update");
  signal.throwIfAborted();
  if (notice === undefined) return { state: "suppressed", reason: "notification_unavailable" };
  if (notice.userId !== purpose.recipientUserId)
    return { state: "suppressed", reason: "purpose_invalid" };
  // A pre-existing legacy marker cannot authorize a second, unsubmitted intent.
  if (notice.emailSentAt !== null) return { state: "deferred" };
  if (!authority.active || authority.invited)
    return { state: "suppressed", reason: "recipient_unavailable" };
  const actor = await hydrateActor(tx, purpose.recipientUserId, signal);
  signal.throwIfAborted();
  if (actor === null) return { state: "suppressed", reason: "recipient_unavailable" };
  if (notice.entityType !== null && notice.entityId !== null) {
    const visible = await canActorAccessParent(
      tx,
      actor,
      notice.entityType,
      notice.entityId,
      signal,
    );
    signal.throwIfAborted();
    if (!visible) return { state: "suppressed", reason: "entity_unavailable" };
  }
  const delivery = await resolveDelivery(tx, purpose.recipientUserId, notice.type, signal);
  signal.throwIfAborted();
  if (!delivery.email) return { state: "suppressed", reason: "preference_disabled" };
  return { state: authority.connected && authority.sendCapable ? "admitted" : "deferred" };
}
