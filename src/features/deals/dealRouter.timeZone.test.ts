import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { deals, userPreferences } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { resolveDatePresetRange } from "@/features/saved-filters/datePresetRange";
import { createCaller } from "@/server/trpc/root";

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";

async function seedBoard(db: Db) {
  const u = await seedUser(db);
  const p = await seedPipelineWithStages(db, ["A"]);
  await db.insert(deals).values({
    title: "evening call",
    pipelineId: p.pipeline.id,
    stageId: p.stages[0]?.id ?? "",
    ownerId: u.id,
    visibilityLevel: "all",
    nextActivityAt: new Date("2026-09-03T02:00:00.000Z"),
  });
  const caller = createCaller({
    db,
    session: { userId: u.id, sessionId: "test-session" },
    actor: {
      id: u.id,
      type: "admin" as const,
      isActive: true,
      name: "Test User",
      email: "test@example.com",
      avatarUrl: null,
      flags: new Set(),
      groupIds: new Set(),
    },
  });
  return { userId: u.id, pipelineId: p.pipeline.id, stageId: p.stages[0]?.id ?? "", caller };
}

function onDay(day: string) {
  return { conditions: [{ field: "nextActivityAt" as const, op: "eq" as const, value: day }] };
}

describe("deal.board date conditions and the viewer's zone", () => {
  it("uses a validated rendered view timezone when no account preference exists", async () => {
    await withTestDb(async (db) => {
      const { pipelineId, caller } = await seedBoard(db);
      const local = await caller.deal.board({
        pipelineId,
        definition: onDay("2026-09-02"),
        timeZone: NY,
      });
      expect(local.cards.map((c) => c.title)).toEqual(["evening call"]);
      const utc = await caller.deal.board({ pipelineId, definition: onDay("2026-09-02") });
      expect(utc.cards).toEqual([]);
    });
  });

  it("prefers the profile timezone over the saved UI and device zones", async () => {
    await withTestDb(async (db) => {
      const { userId, pipelineId, caller } = await seedBoard(db);
      await db.insert(userPreferences).values({
        userId,
        timezone: TOKYO,
        ui: { localePreferences: { locale: "en", calendar: "gregory", timeZone: NY } },
      });
      const tokyoDay = await caller.deal.board({
        pipelineId,
        definition: onDay("2026-09-03"),
        timeZone: NY,
      });
      expect(tokyoDay.cards.map((c) => c.title)).toEqual(["evening call"]);
      const nyDay = await caller.deal.board({
        pipelineId,
        definition: onDay("2026-09-02"),
        timeZone: NY,
      });
      expect(nyDay.cards).toEqual([]);
    });
  });

  it("uses the saved UI zone for both board and list when the profile zone is unset", async () => {
    await withTestDb(async (db) => {
      const { userId, pipelineId, caller } = await seedBoard(db);
      await db.insert(userPreferences).values({
        userId,
        ui: { localePreferences: { locale: "en", calendar: "gregory", timeZone: NY } },
      });
      const board = await caller.deal.board({
        pipelineId,
        definition: onDay("2026-09-02"),
        timeZone: TOKYO,
      });
      expect(board.cards.map((c) => c.title)).toEqual(["evening call"]);
      const res = await caller.deal.list({
        pipelineId,
        definition: onDay("2026-09-02"),
        timeZone: NY,
      });
      expect(res.rows.map((r) => r.title)).toEqual(["evening call"]);
    });
  });
});

it("uses the saved calendar independently of language on both server reads", async () => {
  await withTestDb(async (db) => {
    const { userId, pipelineId, stageId, caller } = await seedBoard(db);
    const calendarPrefs = {
      locale: "en" as const,
      calendar: "persian" as const,
      timeZone: "Asia/Tehran",
    };
    const now = new Date();
    const solar = resolveDatePresetRange("this_month", { ...calendarPrefs, now });
    const gregorian = resolveDatePresetRange("this_month", {
      ...calendarPrefs,
      calendar: "gregory",
      now,
    });
    const exclusiveDate =
      solar.startDate < gregorian.startDate
        ? solar.startDate
        : new Date(new Date(`${solar.endDateExclusive}T00:00:00Z`).getTime() - 86400000)
            .toISOString()
            .slice(0, 10);
    await db.insert(deals).values({
      title: "Solar month only",
      pipelineId,
      stageId,
      ownerId: userId,
      visibilityLevel: "all",
      expectedCloseDate: exclusiveDate,
    });
    const definition = {
      conditions: [{ field: "expectedCloseDate" as const, op: "eq" as const, value: "this_month" }],
    };
    // Legacy cookie-based views get the same interpretation until account preferences exist.
    expect(
      (await caller.deal.board({ pipelineId, definition, ...calendarPrefs })).cards.map(
        (c) => c.title,
      ),
    ).toEqual(["Solar month only"]);
    expect(
      (await caller.deal.list({ pipelineId, definition, ...calendarPrefs })).rows.map(
        (c) => c.title,
      ),
    ).toEqual(["Solar month only"]);
    await db.insert(userPreferences).values({ userId, ui: { localePreferences: calendarPrefs } });
    // A supplied view calendar cannot override saved account preferences.
    expect(
      (
        await caller.deal.board({ pipelineId, definition, calendar: "gregory", locale: "fa" })
      ).cards.map((c) => c.title),
    ).toEqual(["Solar month only"]);
    expect((await caller.deal.board({ pipelineId, definition })).cards.map((c) => c.title)).toEqual(
      ["Solar month only"],
    );
    expect((await caller.deal.list({ pipelineId, definition })).rows.map((c) => c.title)).toEqual([
      "Solar month only",
    ]);
    await db
      .update(userPreferences)
      .set({ ui: { localePreferences: { ...calendarPrefs, calendar: "gregory", locale: "fa" } } })
      .where(eq(userPreferences.userId, userId));
    expect((await caller.deal.board({ pipelineId, definition, ...calendarPrefs })).cards).toEqual(
      [],
    );
    expect((await caller.deal.list({ pipelineId, definition, ...calendarPrefs })).rows).toEqual([]);
  });
});
