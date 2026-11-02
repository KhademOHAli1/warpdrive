import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { permissionSets, teamMembers, teams } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { setPreference } from "@/features/notifications/preferences";
import { ok } from "@/types/result";
import { runEmailNotificationJob } from "./job";
import {
  assertNotificationJobAccepted,
  connectNotificationMailbox,
  insertJobNotification,
  notificationJobTransport,
  seedNotificationDeal,
} from "./notificationJob.test-helpers";

it("emails a team manager who sees the deal only through team.viewMembers", async () => {
  await withTestDb(async (db) => {
    const [set] = await db
      .insert(permissionSets)
      .values({
        name: "Notification manager",
        flags: { "team.viewMembers": true },
      })
      .returning();
    if (set === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Manager fixture permission set missing");
    const manager = await seedUser(db, { permissionSetId: set.id });
    const member = await seedUser(db);
    const [team] = await db
      .insert(teams)
      .values({ name: "Notification team", managerId: manager.id })
      .returning();
    if (team === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Manager fixture team missing");
    await db.insert(teamMembers).values({ teamId: team.id, userId: member.id });
    const signal = AbortSignal.timeout(30_000);
    const account = await connectNotificationMailbox(db, manager.id, signal);
    await setPreference(db, manager.id, "activity_reminder", { inApp: true, email: true }, signal);
    const dealId = await seedNotificationDeal(db, member.id, "owner", signal);
    const notification = await insertJobNotification(
      db,
      {
        userId: manager.id,
        type: "activity_reminder",
        entityType: "deal",
        entityId: dealId,
        payload: { subject: "Meeting" },
      },
      signal,
    );
    const transport = notificationJobTransport();
    expect(
      await runEmailNotificationJob(
        db,
        { notificationId: notification.id },
        signal,
        transport.deps,
      ),
    ).toEqual(ok({ sent: true }));
    expect(transport.gmail.calls.filter((call) => call.method === "sendRaw")).toHaveLength(1);
    await assertNotificationJobAccepted(db, { notificationId: notification.id, account, signal });
  });
});
