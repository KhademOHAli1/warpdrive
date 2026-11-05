import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  EXACT_LEGACY_VALUE,
  insertHistoryDeal,
  prepareHistoryCapture,
} from "./history/capture.test-helpers";
import {
  type NativePeriodForecastRequest,
  nativePeriodForecastInput,
  readNativePeriodForecast,
} from "./nativePeriodForecast";

const signal = () => AbortSignal.timeout(10_000);
const scenarios = {
  conservative: { pWin: "0", pCloseInPeriodGivenWin: "0.5" },
  base: { pWin: "0.5", pCloseInPeriodGivenWin: "0.5", sizeMultiplier: "2" },
  upside: { pWin: "0.9", pCloseInPeriodGivenWin: null },
};

async function withForecastDb(run: (h: TestDb) => Promise<void>) {
  const h = await makeTestDb();
  try {
    await run(h);
  } finally {
    await h.close();
  }
}

async function addUser(h: TestDb): Promise<string> {
  const id = randomUUID();
  await h.pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Forecast fixture')", [
    id,
    `forecast-fixture-${id}@example.test`,
  ]);
  return id;
}

async function principal(h: TestDb, userId: string, viewOthers = false) {
  const sessionId = randomUUID();
  await h.pool.query(
    `INSERT INTO sessions(id,token_hash,user_id,expires_at,auth_method,assurance)
    VALUES($1,$2,$3,pg_catalog.clock_timestamp()+interval '1 hour','legacy','legacy')`,
    [sessionId, `forecast-scenario-${sessionId}`, userId],
  );
  if (viewOthers) {
    const permissionId = randomUUID();
    await h.pool.query(
      "INSERT INTO permission_sets(id,name,flags) VALUES($1,$2,'{\"stats.viewOthers\":true}'::jsonb)",
      [permissionId, `forecast-scenario-${permissionId}`],
    );
    await h.pool.query("UPDATE users SET permission_set_id=$1 WHERE id=$2", [permissionId, userId]);
  }
  const actor = await hydrateActor(h.db, userId, signal());
  if (actor === null) throw new Error("Expected an active forecast fixture actor");
  return { actor, session: { userId, sessionId } };
}

async function dates(h: TestDb, fromOffset = 2, toOffset = 5) {
  const { rows } = await h.pool.query<{ from: string; to: string }>(
    `WITH day AS (
      SELECT (pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Berlin')::date AS local_day
    )
    SELECT pg_catalog.to_char(local_day + $1::int,'YYYY-MM-DD') AS "from",
      pg_catalog.to_char(local_day + $2::int,'YYYY-MM-DD') AS "to" FROM day`,
    [fromOffset, toOffset],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Expected bounded fixture dates");
  return row;
}

async function request(
  h: TestDb,
  pipelineId: string | null,
  patch: Partial<NativePeriodForecastRequest> = {},
): Promise<NativePeriodForecastRequest> {
  return {
    policyVersion: 1,
    currency: "EUR",
    pipelineId,
    ownerScope: { kind: "me" },
    ...(await dates(h)),
    scenarios,
    ...patch,
  };
}

test("applies declared what-if factors to the complete authorized captured roster only", async () => {
  await withForecastDb(async (h) => {
    const fixture = await prepareHistoryCapture(h);
    const viewer = await principal(h, fixture.userId, true);
    await setPreferences(
      h.db,
      fixture.userId,
      {
        timezone: "Europe/Berlin",
        ui: { localePreferences: { locale: "en", calendar: "persian", timeZone: "Europe/Berlin" } },
      },
      signal(),
    );
    await h.pool.query("UPDATE deals SET expected_close_date=CURRENT_DATE + 30 WHERE id=$1", [
      fixture.dealId,
    ]);
    await insertHistoryDeal(h.pool, fixture, { value: null });
    await insertHistoryDeal(h.pool, fixture, { currency: "USD" });
    const closed = await insertHistoryDeal(h.pool, fixture);
    await h.pool.query(
      "UPDATE deals SET status='won',won_time=pg_catalog.clock_timestamp() WHERE id=$1",
      [closed.id],
    );
    const hidden = await insertHistoryDeal(h.pool, { ...fixture, userId: await addUser(h) });
    const input = await request(h, fixture.pipelineId, { ownerScope: { kind: "all" } });
    const result = await readNativePeriodForecast(h.db, viewer, input, signal());

    expect(result).toMatchObject({
      state: "available",
      basis: "explicit-manual-what-if",
      rosterBasis: "captured-current-open-deals",
      policyVersion: 1,
      calculationVersion: 1,
      currency: "EUR",
      target: { timeZone: "Europe/Berlin", calendar: "persian" },
      targetDates: { from: input.from, to: input.to },
      scope: { pipeline: "selected", owner: "all" },
      openDealCount: 2,
      assumptions: scenarios,
      recordedOpenValue: { knownTotal: EXACT_LEGACY_VALUE, knownDealCount: 1, missingDealCount: 1 },
      scenarios: {
        conservative: {
          expectedWonCount: { knownTotal: "0", knownDealCount: 2, missingDealCount: 0 },
          expectedWonValue: { knownTotal: "0.0000", knownDealCount: 1, missingDealCount: 1 },
        },
        base: {
          expectedWonCount: { knownTotal: "0.5", knownDealCount: 2, missingDealCount: 0 },
          expectedWonValue: {
            knownTotal: "49999999999999.5617",
            knownDealCount: 1,
            missingDealCount: 1,
          },
        },
        upside: {
          expectedWonCount: { knownTotal: null, knownDealCount: 0, missingDealCount: 2 },
          missingTimingProbabilityCount: 2,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain(fixture.dealId);
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect(JSON.stringify(result)).not.toContain("incarnationId");
    expect(JSON.stringify(result)).not.toContain("transactionSnapshot");

    expect(
      await readNativePeriodForecast(h.db, viewer, { ...input, currency: "GBP" }, signal()),
    ).toMatchObject({ state: "available", openDealCount: 0 });
  });
});

test("withholds a roster if capture is missing or any visible open deal lacks a qualified tip", async () => {
  await withForecastDb(async (h) => {
    const uninstalledViewer = await principal(h, await addUser(h));
    expect(
      await readNativePeriodForecast(h.db, uninstalledViewer, await request(h, null), signal()),
    ).toEqual({ state: "unavailable", reason: "capture-not-installed" });

    const fixture = await prepareHistoryCapture(h);
    const viewer = await principal(h, fixture.userId);
    await h.pool.query("ALTER TABLE deals DISABLE TRIGGER analytics_deals_capture");
    try {
      await insertHistoryDeal(h.pool, fixture, { value: "500.0000" });
    } finally {
      await h.pool.query("ALTER TABLE deals ENABLE ALWAYS TRIGGER analytics_deals_capture");
    }
    expect(
      await readNativePeriodForecast(h.db, viewer, await request(h, fixture.pipelineId), signal()),
    ).toEqual({ state: "unavailable", reason: "roster-unqualified" });
  });
});

test("requires declared factors and a target whose whole civil period is in the future", async () => {
  await withForecastDb(async (h) => {
    const fixture = await prepareHistoryCapture(h);
    const viewer = await principal(h, fixture.userId);
    const input = await request(h, fixture.pipelineId);
    expect(
      nativePeriodForecastInput.safeParse({
        ...input,
        scenarios: { ...scenarios, base: { pWin: "0.5" } },
      }).success,
    ).toBe(false);
    expect(
      nativePeriodForecastInput.safeParse({
        ...input,
        scenarios: { ...scenarios, base: { pWin: "1.001", pCloseInPeriodGivenWin: "1" } },
      }).success,
    ).toBe(false);
    const started = { ...input, ...(await dates(h, -2, 2)) };
    expect(await readNativePeriodForecast(h.db, viewer, started, signal())).toEqual({
      state: "unavailable",
      reason: "target-not-future",
    });
    expect(
      await readNativePeriodForecast(
        h.db,
        viewer,
        { ...input, ownerScope: { kind: "all" } },
        signal(),
      ),
    ).toEqual({ state: "unavailable", reason: "scope-unavailable" });
  });
});
