import { eq } from "drizzle-orm";
import { assert, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { calendarMembers, sessions } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { createSession } from "@/features/auth/session";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { runCalendarSettingsCommand } from "./calendarSettingsCommand";
import { createCalendar, setCalendarMember } from "./calendars";

it("rechecks the exact native session before a calendar share command uses a captured actor", async () => {
  const h = await makeTestDb();
  const signal = AbortSignal.timeout(10_000);
  try {
    const owner = await seedUser(h.db, { isAdmin: true });
    const recipient = await seedUser(h.db);
    const actor = await hydrateActor(h.db, owner.id, signal);
    assert(actor !== null);
    const session = await createSession(h.db, owner.id, signal);
    assert(session.ok);
    const calendar = await createCalendar(
      h.db,
      actor,
      { name: "Current session only", timeZone: "UTC" },
      signal,
    );
    assert(calendar.ok);
    const context = {
      db: h.db,
      actor,
      session: { userId: owner.id, sessionId: session.value.sessionId },
    };
    await h.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.value.sessionId));
    expect(
      await runCalendarSettingsCommand(context, signal, (db, current) =>
        setCalendarMember(
          db,
          current,
          {
            calendarId: calendar.value.id,
            userId: recipient.id,
            role: "reader",
          },
          signal,
        ),
      ),
    ).toMatchObject({ ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } });
    expect(await h.db.select().from(calendarMembers)).toHaveLength(0);
  } finally {
    await h.close();
  }
});
