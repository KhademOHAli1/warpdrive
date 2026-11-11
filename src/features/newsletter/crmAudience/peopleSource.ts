import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { persons, savedFilters } from "@/db/schema";
import { toRefActor } from "@/features/contacts/actorAdapters";
import {
  compileContactFilter,
  PERSON_COLUMN_SQL,
  PERSON_FILTER_CONFIG,
} from "@/features/contacts/contactFilter";
import { contactVisibilityClause } from "@/features/contacts/visibilitySql";
import type { PermSetUser } from "@/features/permissions/effective";
import { listCompatibleSavedFilterViews } from "@/features/saved-filters/savedFilterList";
import { storedViewDefinition } from "@/features/saved-filters/storedViewDefinition";

import { maxNewsletterAudiencePeople as maxAudiencePeople } from "../identity/contracts";

export { maxAudiencePeople };

export async function listAudienceViews(db: Db, actor: PermSetUser) {
  const rows = await listCompatibleSavedFilterViews({ db, actor }, "person");
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    available: row.definition !== null,
  }));
}

export async function readAudiencePeople(
  db: Db,
  actor: PermSetUser,
  viewId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const [view] = await db
    .select({
      id: savedFilters.id,
      updatedAt: savedFilters.updatedAt,
      raw: savedFilters.definition,
    })
    .from(savedFilters)
    .where(
      and(
        eq(savedFilters.id, viewId),
        eq(savedFilters.targetEntity, "person"),
        or(eq(savedFilters.ownerId, actor.id), eq(savedFilters.isShared, true)),
      ),
    )
    .limit(1);
  if (view === undefined) throw new TRPCError({ code: "NOT_FOUND" });
  const { definition } = storedViewDefinition("person", view.raw);
  if (definition === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This saved People view cannot be used as an audience.",
    });
  }

  const visibility = contactVisibilityClause(toRefActor(actor), {
    ownerId: sql`${persons.ownerId}`,
    visibilityLevel: sql`${persons.visibilityLevel}`,
    visibilityGroupId: sql`${persons.visibilityGroupId}`,
    visibleToUserIds: sql`${persons.visibleToUserIds}`,
  });
  const filter = compileContactFilter(definition, PERSON_FILTER_CONFIG, PERSON_COLUMN_SQL);
  const people = await db
    .select({
      id: persons.id,
      name: persons.name,
      hasAddress: sql<boolean>`${persons.primaryEmail} IS NOT NULL OR jsonb_array_length(${persons.emails}) > 0`,
    })
    .from(persons)
    .where(and(isNull(persons.deletedAt), visibility, filter ?? undefined))
    .orderBy(persons.id)
    .limit(maxAudiencePeople + 1);
  signal.throwIfAborted();

  if (people.length > maxAudiencePeople) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Narrow this People view to 1,000 or fewer contacts before approving it.",
    });
  }
  return { viewId: view.id, revision: view.updatedAt.toISOString(), definition, people };
}
