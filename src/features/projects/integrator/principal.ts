import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema/identity";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { type ProjectIntegratorAccess, projectIntegratorWorkspace } from "./contracts";
import { projectIntegratorDigest } from "./keyFormat";
import { projectIntegratorKeys as keys } from "./schema";

const proof = Symbol("project integrator authority");

export type ProjectIntegratorPrincipal = {
  readonly [proof]: true;
  readonly keyId: string;
  readonly digest: string;
  readonly userId: string;
  readonly required: ProjectIntegratorAccess;
};

function activeKey(digest: string) {
  return and(
    eq(keys.workspaceSlug, projectIntegratorWorkspace),
    eq(keys.tokenHash, digest),
    isNull(keys.revokedAt),
    or(isNull(keys.expiresAt), gt(keys.expiresAt, sql`clock_timestamp()`)),
  );
}

async function readKey(db: Db, digest: string) {
  const [row] = await db
    .select({ id: keys.id, userId: keys.userId, access: keys.access })
    .from(keys)
    .innerJoin(users, eq(users.id, keys.userId))
    .where(
      and(
        activeKey(digest),
        eq(users.isActive, true),
        isNull(users.invitedAt),
        eq(users.projectsGuestOnly, false),
      ),
    )
    .for("share", { of: keys });
  return row;
}

export async function authorizeProjectIntegrator(
  db: Db,
  token: string | null,
  required: ProjectIntegratorAccess,
  signal: AbortSignal,
) {
  const digest = projectIntegratorDigest(token);
  if (digest === null) return err("unauthorized" as const);
  return withCurrentAuthority(db, "read", signal, async (tx) => {
    const key = await readKey(tx, digest);
    if (key === undefined) return err("unauthorized" as const);
    if (required === "write" && key.access !== "write") return err("forbidden" as const);
    const principal: ProjectIntegratorPrincipal = {
      [proof]: true,
      keyId: key.id,
      digest,
      userId: key.userId,
      required,
    };
    return ok(principal);
  });
}

export function isProjectIntegratorPrincipal(value: object): value is ProjectIntegratorPrincipal {
  return proof in value && value[proof] === true;
}

export async function currentProjectIntegratorActor(
  db: Db,
  principal: ProjectIntegratorPrincipal,
  signal: AbortSignal,
) {
  const key = await readKey(db, principal.digest);
  if (key?.id !== principal.keyId || key.userId !== principal.userId) return null;
  if (principal.required === "write" && key.access !== "write") return null;
  const [setting] = await db
    .select({ enabled: agencyProjectSettings.enabled })
    .from(agencyProjectSettings)
    .where(eq(agencyProjectSettings.id, true));
  if (setting?.enabled !== true) return null;
  return hydrateActor(db, principal.userId, signal);
}

export async function noteProjectIntegratorUse(db: Db, principal: ProjectIntegratorPrincipal) {
  await db
    .update(keys)
    .set({ usedAt: sql`clock_timestamp()` })
    .where(
      and(
        activeKey(principal.digest),
        eq(keys.id, principal.keyId),
        or(isNull(keys.usedAt), gt(sql`clock_timestamp() - interval '1 minute'`, keys.usedAt)),
      ),
    );
}
