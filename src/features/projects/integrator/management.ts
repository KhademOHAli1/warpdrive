import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { err, ok } from "@/types/result";
import { withInternalProjects } from "../access";
import {
  type ProjectIntegratorAccess,
  type ProjectIntegratorKey,
  projectIntegratorWorkspace,
} from "./contracts";
import { generateProjectIntegratorCredential, projectIntegratorDigest } from "./keyFormat";
import { projectIntegratorKeys as keys } from "./schema";

const keyFields = {
  id: keys.id,
  name: keys.name,
  hint: keys.hint,
  access: keys.access,
  createdAt: keys.createdAt,
  expiresAt: keys.expiresAt,
  usedAt: keys.usedAt,
  revokedAt: keys.revokedAt,
};
type KeyRow = Pick<typeof keys.$inferSelect, keyof typeof keyFields>;

function toKey(row: KeyRow): ProjectIntegratorKey {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    usedAt: row.usedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function ownerScope(userId: string) {
  return and(eq(keys.userId, userId), eq(keys.workspaceSlug, projectIntegratorWorkspace));
}

export function listProjectIntegratorKeys(db: Db, session: NativeSessionRef, signal: AbortSignal) {
  return withInternalProjects<ProjectIntegratorKey[]>(db, session, signal, async (tx, actor) => {
    if (actor.projectsGuestOnly === true) return err("project_forbidden");
    const rows = await tx
      .select(keyFields)
      .from(keys)
      .where(ownerScope(actor.id))
      .orderBy(desc(keys.createdAt), desc(keys.id));
    return ok(rows.map(toKey));
  });
}

export function issueProjectIntegratorKey(
  db: Db,
  session: NativeSessionRef,
  {
    name,
    access,
    expiresAt,
  }: { name: string; access: ProjectIntegratorAccess; expiresAt?: string | null },
  signal: AbortSignal,
) {
  return withInternalProjects<{ key: ProjectIntegratorKey; token: string }>(
    db,
    session,
    signal,
    async (tx, actor) => {
      if (actor.projectsGuestOnly === true) return err("project_forbidden");
      const expiration = expiresAt == null ? null : new Date(expiresAt);
      if (expiration !== null && !(expiration > new Date())) return err("project_invalid");
      const token = generateProjectIntegratorCredential();
      const tokenHash = projectIntegratorDigest(token);
      if (tokenHash === null)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Generated Project key failed its format");
      const [issued] = await tx
        .insert(keys)
        .values({
          workspaceSlug: projectIntegratorWorkspace,
          userId: actor.id,
          name,
          tokenHash,
          hint: token.slice(-4),
          access,
          expiresAt: expiration,
        })
        .returning(keyFields);
      if (issued === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "Project integration key was not issued");
      return ok({ key: toKey(issued), token });
    },
  );
}

export function revokeProjectIntegratorKey(
  db: Db,
  session: NativeSessionRef,
  keyId: string,
  signal: AbortSignal,
) {
  return withInternalProjects<ProjectIntegratorKey>(db, session, signal, async (tx, actor) => {
    if (actor.projectsGuestOnly === true) return err("project_forbidden");
    const scope = and(ownerScope(actor.id), eq(keys.id, keyId));
    const [updated] = await tx
      .update(keys)
      .set({ revokedAt: sql`clock_timestamp()` })
      .where(and(scope, isNull(keys.revokedAt)))
      .returning(keyFields);
    if (updated !== undefined) return ok(toKey(updated));
    const [existing] = await tx.select(keyFields).from(keys).where(scope);
    return existing === undefined ? err("project_unavailable") : ok(toKey(existing));
  });
}
