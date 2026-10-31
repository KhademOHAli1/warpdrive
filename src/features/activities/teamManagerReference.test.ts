import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { activityTypes, permissionSets, persons, teamMembers, teams } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { createActivity } from "./repo";

it("lets a team manager link an activity to an owner-only person owned by a managed member", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(5000);
    const [set] = await db
      .insert(permissionSets)
      .values({ name: "manager", flags: { "team.viewMembers": true } })
      .returning();
    const manager = await seedUser(db, { permissionSetId: set?.id });
    const member = await seedUser(db);
    const [team] = await db.insert(teams).values({ name: "T", managerId: manager.id }).returning();
    await db.insert(teamMembers).values({ teamId: team?.id ?? "", userId: member.id });
    const [person] = await db
      .insert(persons)
      .values({ name: "Owned By Member", ownerId: member.id, visibilityLevel: "owner" })
      .returning();
    const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "call"));
    const actor = await hydrateActor(db, manager.id, signal);

    const r = await createActivity(
      db,
      actor!,
      { typeId: type?.id ?? "", subject: "Follow up", personId: person?.id ?? null },
      signal,
    );

    expect(r.ok).toBe(true);
  });
});
