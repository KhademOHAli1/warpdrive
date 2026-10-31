import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { authSecurityEvents } from "@/db/schema/authManagement";
import type { PermSetUser } from "@/features/permissions/effective";
import type { ManagementQuery } from "./contracts";
import { MANAGEMENT_PAGE_SIZE } from "./domain";

const eventActor = alias(users, "security_event_actor");
const eventTarget = alias(users, "security_event_target");

export async function readSecurityAudit(
  db: Db,
  actor: PermSetUser,
  query: ManagementQuery,
  signal: AbortSignal,
) {
  if (!actor.isActive || actor.type !== "admin")
    return { rows: [], page: 1, pageCount: 1, total: 0 };
  signal.throwIfAborted();
  const search = (query.auditQ ?? "").trim().replace(/[\\%_]/g, "\\$&");
  const where = and(
    search === ""
      ? undefined
      : or(
          ilike(authSecurityEvents.action, `%${search}%`),
          ilike(eventActor.name, `%${search}%`),
          ilike(eventTarget.name, `%${search}%`),
        ),
    query.auditOutcome === undefined || query.auditOutcome === "all"
      ? undefined
      : eq(authSecurityEvents.outcome, query.auditOutcome),
  );
  const [counter] = await db
    .select({ total: count() })
    .from(authSecurityEvents)
    .leftJoin(eventActor, eq(eventActor.id, authSecurityEvents.actorId))
    .leftJoin(eventTarget, eq(eventTarget.id, authSecurityEvents.targetUserId))
    .where(where);
  const total = counter?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MANAGEMENT_PAGE_SIZE));
  const page = Math.min(Math.max(1, query.auditPage ?? 1), pageCount);
  const rows = await db
    .select({
      id: authSecurityEvents.id,
      actorId: authSecurityEvents.actorId,
      actorName: eventActor.name,
      targetUserId: authSecurityEvents.targetUserId,
      targetName: eventTarget.name,
      action: authSecurityEvents.action,
      outcome: authSecurityEvents.outcome,
      createdAt: authSecurityEvents.createdAt,
    })
    .from(authSecurityEvents)
    .leftJoin(eventActor, eq(eventActor.id, authSecurityEvents.actorId))
    .leftJoin(eventTarget, eq(eventTarget.id, authSecurityEvents.targetUserId))
    .where(where)
    .orderBy(desc(authSecurityEvents.createdAt), authSecurityEvents.id)
    .limit(MANAGEMENT_PAGE_SIZE)
    .offset((page - 1) * MANAGEMENT_PAGE_SIZE);
  signal.throwIfAborted();
  return { rows, page, pageCount, total };
}
