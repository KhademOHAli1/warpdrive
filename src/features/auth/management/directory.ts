import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import type { Db } from "@/db/client";
import { permissionSets, sessions, users } from "@/db/schema";
import {
  authIntegrationRevocations,
  authInvitations,
  authMailOutbox,
  authRecoveryRequests,
} from "@/db/schema/authManagement";
import { decryptToken } from "@/features/email/crypto";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { readSecurityAudit } from "./auditDirectory";
import type { ManagementQuery, ManagementSnapshot } from "./contracts";
import { invitationState, MANAGEMENT_PAGE_SIZE } from "./domain";
import { readAuthPolicy } from "./policy";

function userFilter(query: ManagementQuery): SQL | undefined {
  const search = query.q.trim().replace(/[\\%_]/g, "\\$&");
  return and(
    search === ""
      ? undefined
      : or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)),
    query.status === "inactive"
      ? eq(users.isActive, false)
      : query.status === "active"
        ? and(eq(users.isActive, true), isNull(users.invitedAt))
        : query.status === "pending"
          ? and(eq(users.isActive, true), isNotNull(users.invitedAt))
          : undefined,
  );
}

export async function readManagementSnapshot(
  db: Db,
  actor: PermSetUser,
  query: ManagementQuery,
  signal: AbortSignal,
): Promise<Result<ManagementSnapshot, "forbidden">> {
  if (!actor.isActive || (actor.type !== "admin" && !actor.flags.has("permissions.manage")))
    return err("forbidden");
  signal.throwIfAborted();
  const where = userFilter(query);
  const [totalRow] = await db.select({ total: count() }).from(users).where(where);
  const total = totalRow?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MANAGEMENT_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isAdmin: users.isAdmin,
      isActive: users.isActive,
      invitedAt: users.invitedAt,
      permissionSetId: users.permissionSetId,
    })
    .from(users)
    .where(where)
    .orderBy(users.name, users.id)
    .limit(MANAGEMENT_PAGE_SIZE)
    .offset((page - 1) * MANAGEMENT_PAGE_SIZE);
  const ids = rows.map((row) => row.id);
  const invitations =
    ids.length === 0
      ? []
      : await db
          .selectDistinctOn([authInvitations.userId])
          .from(authInvitations)
          .where(inArray(authInvitations.userId, ids))
          .orderBy(
            authInvitations.userId,
            desc(authInvitations.createdAt),
            desc(authInvitations.id),
          );
  const sessionCounts =
    ids.length === 0
      ? []
      : await db
          .select({ userId: sessions.userId, total: count() })
          .from(sessions)
          .where(
            and(
              inArray(sessions.userId, ids),
              isNull(sessions.revokedAt),
              gt(sessions.expiresAt, new Date()),
            ),
          )
          .groupBy(sessions.userId);
  const counts = new Map(sessionCounts.map((row) => [row.userId, row.total]));
  const invitationByUser = new Map(invitations.map((row) => [row.userId, row]));
  const deliveries = await db
    .select({
      id: authMailOutbox.id,
      recipient: authMailOutbox.recipient,
      kind: authMailOutbox.kind,
      status: authMailOutbox.status,
      attempts: authMailOutbox.attempts,
      createdAt: authMailOutbox.createdAt,
      lastErrorCode: authMailOutbox.lastErrorCode,
      invitationId: authMailOutbox.invitationId,
    })
    .from(authMailOutbox)
    .orderBy(desc(authMailOutbox.createdAt))
    .limit(25);
  const deliveryByInvitation = new Map(
    deliveries
      .filter((mail) => mail.invitationId !== null)
      .map((mail) => [mail.invitationId, mail.status]),
  );
  const admin = actor.type === "admin";
  const audit = await readSecurityAudit(db, actor, query, signal);
  const requests = admin
    ? await db
        .select({
          id: authRecoveryRequests.id,
          userId: authRecoveryRequests.userId,
          name: users.name,
          email: users.email,
          kind: authRecoveryRequests.kind,
          status: authRecoveryRequests.status,
          createdAt: authRecoveryRequests.createdAt,
          reasonEnc: authRecoveryRequests.reasonEnc,
        })
        .from(authRecoveryRequests)
        .innerJoin(users, eq(users.id, authRecoveryRequests.userId))
        .orderBy(desc(authRecoveryRequests.createdAt))
        .limit(25)
    : [];
  const revocations = admin
    ? await db
        .select({
          id: authIntegrationRevocations.id,
          userId: authIntegrationRevocations.userId,
          provider: authIntegrationRevocations.provider,
          status: authIntegrationRevocations.status,
          attempts: authIntegrationRevocations.attempts,
          createdAt: authIntegrationRevocations.createdAt,
        })
        .from(authIntegrationRevocations)
        .orderBy(desc(authIntegrationRevocations.createdAt))
        .limit(25)
    : [];
  const sets = await db
    .select({ id: permissionSets.id, name: permissionSets.name })
    .from(permissionSets)
    .orderBy(permissionSets.name);
  const assignees = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.isActive, true), isNull(users.invitedAt)))
    .orderBy(users.name);
  const policy = await readAuthPolicy(db, signal);
  signal.throwIfAborted();
  return ok({
    viewerIsAdmin: admin,
    total,
    page,
    pageCount,
    policy,
    permissionSets: sets,
    assignees,
    users: rows.map((row) => {
      const invitation = invitationByUser.get(row.id);
      return {
        ...row,
        invitedAt: row.invitedAt?.toISOString() ?? null,
        activeSessions: counts.get(row.id) ?? 0,
        invitation:
          invitation === undefined
            ? null
            : {
                id: invitation.id,
                state: invitationState(invitation),
                expiresAt: invitation.expiresAt.toISOString(),
                delivery: deliveryByInvitation.get(invitation.id) ?? null,
              },
      };
    }),
    deliveries: deliveries.map((mail) => ({
      id: mail.id,
      recipient: mail.recipient,
      kind: mail.kind,
      status: mail.status,
      attempts: mail.attempts,
      lastErrorCode: mail.lastErrorCode,
      createdAt: mail.createdAt.toISOString(),
    })),
    auditPage: audit.page,
    auditPageCount: audit.pageCount,
    auditTotal: audit.total,
    audit: audit.rows.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
    requests: requests.map(({ reasonEnc, ...request }) => {
      const reason = reasonEnc === null ? null : decryptToken(reasonEnc);
      return {
        ...request,
        reason: reason?.ok === true ? reason.value : null,
        createdAt: request.createdAt.toISOString(),
      };
    }),
    integrationRevocations: revocations.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
