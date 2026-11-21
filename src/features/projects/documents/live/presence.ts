import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions, users } from "@/db/schema/identity";
import { checkProjectLocalAction } from "@/features/agency-projects/projectLocalAccess";
import { agencyProjectMembers } from "@/features/agency-projects/schema/agencyProjects";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import type { InternalProjectAccess } from "../../access";
import {
  internalProjectDocuments as documents,
  internalProjectDocumentPresence as presence,
} from "../schema";
import type {
  ProjectDocumentCollaboration,
  ProjectDocumentPeer,
  ProjectDocumentPresence,
} from "./contracts";

const maxPeers = 32;
const now = sql`statement_timestamp()`;
const expiry = sql`statement_timestamp() + interval '15 seconds'`;

type Scope = Pick<ProjectDocumentCollaboration, "epoch" | "document" | "canEdit">;

// Expiry is enforced in every read. Active pages also sweep a bounded set of physically
// expired rows, including stale rows from idle pages. Closing a normal editor sends a leave.
async function clearExpiredPresence(db: Db) {
  await db.delete(presence).where(sql`ctid in (
    select ctid from ${presence}
    where ${presence.expiresAt} <= ${now}
    order by ${presence.expiresAt}
    limit 64 for update skip locked
  )`);
}

async function writePresence(
  db: Db,
  who: NativeSessionRef,
  scope: Scope,
  update: ProjectDocumentPresence,
) {
  const documentId = scope.document.id;
  const session = eq(presence.sessionId, who.sessionId);
  const currentClient = and(
    eq(presence.documentId, documentId),
    eq(presence.clientId, update.clientId),
  );
  if (update.leave === true) {
    await db.delete(presence).where(and(currentClient, session, eq(presence.epoch, scope.epoch)));
    return;
  }
  // Serialize admission for this page. Content writers acquire project authority
  // before touching the same document row, so this keeps a consistent lock order.
  await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, documentId))
    .for("no key update");
  const current = await db
    .select({ clientId: presence.clientId, sessionId: presence.sessionId })
    .from(presence)
    .where(and(eq(presence.documentId, documentId), gt(presence.expiresAt, now)))
    .limit(maxPeers);
  if (
    current.length >= maxPeers &&
    !current.some((peer) => peer.clientId === update.clientId && peer.sessionId === who.sessionId)
  )
    return;
  const fields = {
    sessionId: who.sessionId,
    expiresAt: expiry,
    epoch: scope.epoch,
    cursor: scope.canEdit ? update.cursor : null,
  };
  await db
    .insert(presence)
    .values({ ...fields, documentId, clientId: update.clientId })
    .onConflictDoUpdate({
      target: [presence.documentId, presence.clientId],
      set: fields,
      setWhere: or(session, lte(presence.expiresAt, now)),
    });
  await clearExpiredPresence(db);
}

export async function exchangeProjectDocumentPresence(
  db: Db,
  who: NativeSessionRef,
  access: InternalProjectAccess,
  scope: Scope,
  update: ProjectDocumentPresence | null,
): Promise<ProjectDocumentPeer[]> {
  if (update !== null) await writePresence(db, who, scope, update);
  const { document, epoch } = scope;
  const projectId = access.summary.id;
  const ownerUserId = access.summary.owner.id;
  const rows = await db
    .select({
      clientId: presence.clientId,
      cursor: presence.cursor,
      user: { id: users.id, name: users.name, isActive: users.isActive, isAdmin: users.isAdmin },
      membership: {
        projectId: agencyProjectMembers.projectId,
        userId: agencyProjectMembers.userId,
        projectEdit: agencyProjectMembers.projectEdit,
        assignmentCoordinate: agencyProjectMembers.assignmentCoordinate,
      },
    })
    .from(presence)
    .innerJoin(sessions, eq(presence.sessionId, sessions.id))
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(
      agencyProjectMembers,
      and(eq(agencyProjectMembers.projectId, projectId), eq(agencyProjectMembers.userId, users.id)),
    )
    .where(
      and(
        eq(presence.documentId, document.id),
        eq(presence.epoch, epoch),
        gt(presence.expiresAt, now),
        gt(sessions.expiresAt, now),
        isNull(sessions.revokedAt),
        eq(users.isActive, true),
        isNull(users.invitedAt),
        or(eq(users.id, ownerUserId), eq(users.id, agencyProjectMembers.userId)),
        document.visibility === "private" ? eq(users.id, document.author.id) : undefined,
      ),
    )
    .orderBy(asc(presence.clientId))
    .limit(maxPeers);
  return rows.map(({ clientId, cursor, user, membership }) => {
    const actor = {
      id: user.id,
      type: user.isAdmin ? ("admin" as const) : ("regular" as const),
      isActive: user.isActive,
    };
    const canShare =
      !document.locked &&
      document.archivedAt === null &&
      checkProjectLocalAction(
        { actor, projectId, ownerUserId, membership },
        access.lifecycle,
        "edit-content",
      ).ok;
    return { clientId, cursor: canShare ? cursor : null, name: user.name };
  });
}
