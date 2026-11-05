import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import type { PoolClient } from "pg";
import { describe, expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { PermissionFlagKey } from "@/constants/permissionFlags";
import { startOfCalendarMonth } from "@/features/activities/calendarSystem";
import { setPreferences } from "@/features/identity/preferencesRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  beginHistoryTransaction,
  type HistoryCaptureFixture,
  insertHistoryDeal,
  prepareHistoryCapture,
  readCaptureEvents,
} from "./capture.test-helpers";
import {
  MAX_DEAL_COHORT_SCOPE,
  type ObservedDealWinCohortRequest,
  type ObservedDealWinCohorts,
  readObservedDealWinCohorts,
} from "./dealCohortRepository";

const signal = () => AbortSignal.timeout(10_000);
const request = {
  from: "2000-01-01",
  to: "2099-12-31",
  currency: "EUR",
  pipelineId: null,
  ownerScope: { kind: "all" },
  horizon: { id: "fixture-window", elapsedNanoseconds: "1" },
} satisfies ObservedDealWinCohortRequest;

function actorFor(id: string): PermSetUser {
  return {
    id,
    type: "regular",
    isActive: true,
    groupIds: new Set(),
    flags: new Set<PermissionFlagKey>(["stats.viewOthers"]),
  };
}

async function withCapture(
  run: (h: TestDb, fixture: HistoryCaptureFixture, actor: PermSetUser) => Promise<void>,
) {
  const h = await makeTestDb();
  h.pool.options.statement_timeout = 5_000;
  h.pool.options.lock_timeout = 2_000;
  try {
    const fixture = await prepareHistoryCapture(h);
    await run(h, fixture, actorFor(fixture.userId));
  } finally {
    await h.close();
  }
}

async function transaction(h: TestDb, run: (client: PoolClient) => Promise<void>) {
  const client = await h.pool.connect();
  try {
    await beginHistoryTransaction(client);
    await run(client);
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

async function markWon(db: Pick<PoolClient, "query">, id: string) {
  await db.query(
    "UPDATE deals SET status='won',won_time='1999-02-03T04:05:06.654321Z',lost_time=NULL WHERE id=$1",
    [id],
  );
}

function available(report: ObservedDealWinCohorts) {
  expect(report.state).toBe("available");
  if (report.state !== "available")
    throw new AppError(ERROR_IDS.DB_READ_FAILED, "Expected covered cohort evidence");
  return report;
}

function contributors(report: ObservedDealWinCohorts) {
  return available(report).result.cohorts.flatMap((cohort) => cohort.contributors);
}

function horizonBetween(from: string, to: string) {
  const elapsed =
    Temporal.Instant.from(to).epochNanoseconds - Temporal.Instant.from(from).epochNanoseconds;
  // The subsequent observation happens after the captured outcome, so the horizon is mature.
  return { id: request.horizon.id, elapsedNanoseconds: (elapsed > 0n ? elapsed : 1n).toString() };
}

describe("native current-authorized observed deal win cohorts", () => {
  test("distinguishes absent capture from an empty observed population", async () => {
    const h = await makeTestDb();
    try {
      const id = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Cohort viewer')", [
        id,
        `${id}@example.test`,
      ]);
      expect(await readObservedDealWinCohorts(h.db, actorFor(id), request, signal())).toEqual({
        state: "missing",
        reason: "capture-not-installed",
      });
    } finally {
      await h.close();
    }
  });

  test("uses captured entry and first transaction-final win with persisted calendar and zone", async () => {
    await withCapture(async (h, f, actor) => {
      await setPreferences(
        h.db,
        actor.id,
        {
          timezone: "Asia/Tehran",
          ui: { localePreferences: { locale: "fa", calendar: "persian", timeZone: "UTC" } },
        },
        signal(),
      );
      const deal = await insertHistoryDeal(h.pool, f, {
        title: "Do not disclose this captured title",
        createdAt: "1998-01-02T03:04:05.123456Z",
      });
      await transaction(h, async (client) => {
        await markWon(client, deal.id);
        await client.query("UPDATE deals SET title='Final transaction witness' WHERE id=$1", [
          deal.id,
        ]);
        await client.query("COMMIT");
      });
      await h.pool.query("UPDATE deals SET status='open',won_time=NULL WHERE id=$1", [deal.id]);
      await markWon(h.pool, deal.id);

      const [entry, transition, final] = await readCaptureEvents(h.pool, "deal", deal.id);
      if (entry === undefined || transition === undefined || final === undefined)
        throw new AppError(
          ERROR_IDS.DB_READ_FAILED,
          "Expected entry and winning transaction evidence",
        );
      expect(transition.transactionId).toBe(final.transactionId);
      expect(entry.afterState?.createdAt).not.toBe(entry.observedAt);
      expect(transition.afterState?.wonTime).not.toBe(transition.observedAt);

      const scopedRequest = {
        ...request,
        horizon: horizonBetween(entry.observedAt, final.observedAt),
      };
      const report = available(
        await readObservedDealWinCohorts(h.db, actor, scopedRequest, signal()),
      );
      expect(report).toMatchObject({
        population: "current-authorized-live-deals",
        baseline: "excluded",
        bucketMembership: "entries-within-covered-interval",
        coverage: {
          state: "partial",
          covered: {
            fromInclusive: report.coverage.activatedAt,
            to: report.coverage.observedAt,
            upperBound: "inclusive",
          },
        },
        result: {
          timeZone: "Asia/Tehran",
          calendar: "persian",
          uniqueSubjectCount: 1,
        },
      });
      expect(report.coverage.requested.fromInclusive).not.toBe(
        report.coverage.covered.fromInclusive,
      );
      expect(report.coverage.requested.toExclusive).not.toBe(report.coverage.covered.to);

      const entryInstant = Temporal.Instant.from(entry.observedAt);
      const localDay = entryInstant.toZonedDateTimeISO("Asia/Tehran").toPlainDate().toString();
      const month = startOfCalendarMonth(new Date(`${localDay}T00:00:00Z`), {
        calendar: "persian",
      });
      expect(report.result.cohorts).toMatchObject([
        {
          bucketId: month.toISOString().slice(0, 10),
          numerator: 1,
          denominator: 1,
          contributors: [
            {
              status: "converted",
              subjectId: `deal:${entry.incarnationId}`,
              entryEventId: `history:${entry.eventId}`,
              enteredAt: entryInstant.toString(),
              conversion: {
                eventId: `history:${final.eventId}`,
                at: Temporal.Instant.from(final.observedAt).toString(),
              },
            },
          ],
        },
      ]);
      const wire = JSON.stringify(report);
      expect(wire).not.toContain("Final transaction witness");
      expect(wire).not.toContain("observationSnapshot");
      expect(wire).not.toContain("beforeState");
    });
  });

  test("leaves unqualified wins unknown and ignores transient same-transaction wins", async () => {
    await withCapture(async (h, f, actor) => {
      const opened = await insertHistoryDeal(h.pool, f);
      const restored = await insertHistoryDeal(h.pool, f);
      const lost = await insertHistoryDeal(h.pool, f);
      const insertedClosed = randomUUID();
      await h.pool.query(
        `INSERT INTO deals (id,title,pipeline_id,stage_id,owner_id,visibility_level,status,currency)
         VALUES ($1,'Closed on insert',$2,$3,$4,'owner','won','EUR')`,
        [insertedClosed, f.pipelineId, f.stageId, f.userId],
      );
      await h.pool.query("UPDATE deals SET archived_at=clock_timestamp() WHERE id=$1", [
        restored.id,
      ]);
      await h.pool.query("UPDATE deals SET archived_at=NULL WHERE id=$1", [restored.id]);
      await markWon(h.pool, restored.id);
      await h.pool.query("UPDATE deals SET status='lost',lost_time=clock_timestamp() WHERE id=$1", [
        lost.id,
      ]);
      await markWon(h.pool, lost.id);
      await transaction(h, async (client) => {
        await markWon(client, opened.id);
        await client.query("UPDATE deals SET status='open',won_time=NULL WHERE id=$1", [opened.id]);
        await client.query("COMMIT");
      });

      const [lostEntry] = await readCaptureEvents(h.pool, "deal", lost.id);
      if (lostEntry === undefined)
        throw new AppError(ERROR_IDS.DB_READ_FAILED, "Expected the lost deal's captured entry");
      const report = available(await readObservedDealWinCohorts(h.db, actor, request, signal()));
      expect(report.result.uniqueSubjectCount).toBe(4);
      const items = contributors(report);
      expect(items.filter((item) => item.status === "mature-unknown")).toHaveLength(3);
      expect(
        items.find((item) => item.entryEventId === `history:${lostEntry.eventId}`),
      ).toMatchObject({
        status: "mature-unknown",
      });
      expect(items.filter((item) => item.status === "no-conversion")).toMatchObject([
        { evidence: { kind: "no-event" } },
      ]);
      expect(
        report.result.cohorts.some(
          (cohort) =>
            cohort.comparison.state === "unavailable" &&
            cohort.comparison.reason === "mature-history-unknown",
        ),
      ).toBe(true);
    });
  });

  test("uses snapshot membership while a lower-ordinal winning transaction remains pending", async () => {
    await withCapture(async (h, f, actor) => {
      const pending = await insertHistoryDeal(h.pool, f);
      const committed = await insertHistoryDeal(h.pool, f);
      const [pendingEntry] = await readCaptureEvents(h.pool, "deal", pending.id);
      const [committedEntry] = await readCaptureEvents(h.pool, "deal", committed.id);
      if (pendingEntry === undefined || committedEntry === undefined)
        throw new AppError(ERROR_IDS.DB_READ_FAILED, "Expected fixture entries");

      await transaction(h, async (client) => {
        await markWon(client, pending.id);
        await markWon(h.pool, committed.id);
        const [, pendingWin] = await readCaptureEvents(client, "deal", pending.id);
        const [, visibleWin] = await readCaptureEvents(h.pool, "deal", committed.id);
        if (pendingWin === undefined || visibleWin === undefined)
          throw new AppError(ERROR_IDS.DB_READ_FAILED, "Expected fixture wins");
        expect(BigInt(pendingWin.ordinal)).toBeLessThan(BigInt(visibleWin.ordinal));

        const scopedRequest = {
          ...request,
          horizon: horizonBetween(committedEntry.observedAt, visibleWin.observedAt),
        };
        const before = contributors(
          await readObservedDealWinCohorts(h.db, actor, scopedRequest, signal()),
        );
        expect(
          before.find((item) => item.entryEventId === `history:${committedEntry.eventId}`),
        ).toMatchObject({
          status: "converted",
          conversion: { eventId: `history:${visibleWin.eventId}` },
        });
        expect(
          before.find((item) => item.entryEventId === `history:${pendingEntry.eventId}`),
        ).toMatchObject({ status: "no-conversion", evidence: { kind: "no-event" } });

        await client.query("COMMIT");
        const afterRequest = {
          ...request,
          horizon: horizonBetween(pendingEntry.observedAt, visibleWin.observedAt),
        };
        const after = contributors(
          await readObservedDealWinCohorts(h.db, actor, afterRequest, signal()),
        );
        expect(
          after.find((item) => item.entryEventId === `history:${pendingEntry.eventId}`),
        ).toMatchObject({
          status: "converted",
          conversion: { eventId: `history:${pendingWin.eventId}` },
        });
      });
    });
  });

  test("rechecks owner permission and fails closed across an inaccessible historical pipeline", async () => {
    await withCapture(async (h, f, actor) => {
      const own = await insertHistoryDeal(h.pool, f);
      const other = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Other owner')", [
        other,
        `${other}@example.test`,
      ]);
      const outsider = await insertHistoryDeal(h.pool, { ...f, userId: other });
      await h.pool.query("UPDATE deals SET visibility_level='all' WHERE id=$1", [outsider.id]);
      const before = available(await readObservedDealWinCohorts(h.db, actor, request, signal()));
      // The stale request grant does not override the user's current persisted owner permission.
      expect(before.result.uniqueSubjectCount).toBe(1);

      const destination = randomUUID();
      const stage = randomUUID();
      await h.pool.query("INSERT INTO pipelines (id,name) VALUES ($1,'Current destination')", [
        destination,
      ]);
      await h.pool.query("INSERT INTO stages (id,pipeline_id,name) VALUES ($1,$2,'Destination')", [
        stage,
        destination,
      ]);
      await h.pool.query("UPDATE deals SET pipeline_id=$2,stage_id=$3 WHERE id=$1", [
        own.id,
        destination,
        stage,
      ]);
      const group = randomUUID();
      await h.pool.query("INSERT INTO visibility_groups (id,name) VALUES ($1,$2)", [group, group]);
      await h.pool.query("UPDATE pipelines SET visibility_group_id=$2 WHERE id=$1", [
        f.pipelineId,
        group,
      ]);
      expect(
        await readObservedDealWinCohorts(
          h.db,
          actor,
          { ...request, pipelineId: destination },
          signal(),
        ),
      ).toEqual({ state: "unavailable", reason: "history-permission-limited" });
    });
  });

  test("refuses a previously private deal even after transfer makes its current row visible", async () => {
    await withCapture(async (h, f, actor) => {
      const previousOwner = randomUUID();
      await h.pool.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Previous owner')", [
        previousOwner,
        `${previousOwner}@example.test`,
      ]);
      const deal = await insertHistoryDeal(h.pool, { ...f, userId: previousOwner });
      await markWon(h.pool, deal.id);
      await h.pool.query("UPDATE deals SET owner_id=$2 WHERE id=$1", [deal.id, actor.id]);
      const result = await readObservedDealWinCohorts(
        h.db,
        actor,
        { ...request, pipelineId: f.pipelineId, ownerScope: { kind: "me" } },
        signal(),
      );
      expect(result).toEqual({ state: "unavailable", reason: "history-permission-limited" });
    });
  });

  test("uses a current device fallback for the cohort observation in saved browser mode", async () => {
    await withCapture(async (h, _fixture, actor) => {
      await setPreferences(
        h.db,
        actor.id,
        {
          timezone: "Europe/Berlin",
          ui: {
            localePreferences: {
              locale: "fa",
              calendar: "persian",
              timeZone: "Europe/Berlin",
              timeZoneMode: "browser",
            },
          },
        },
        signal(),
      );
      const report = available(
        await readObservedDealWinCohorts(h.db, actor, request, signal(), {
          timeZone: "America/Los_Angeles",
          calendar: "gregory",
        }),
      );
      expect(report.result).toMatchObject({ timeZone: "America/Los_Angeles", calendar: "persian" });
    });
  });

  test("returns unavailable when the requested window predates capture or the live scope overflows", async () => {
    await withCapture(async (h, f, actor) => {
      expect(
        await readObservedDealWinCohorts(
          h.db,
          actor,
          { ...request, from: "1990-01-01", to: "1990-12-31" },
          signal(),
        ),
      ).toMatchObject({ state: "unavailable", reason: "period-outside-capture" });

      await h.pool.query(
        `INSERT INTO deals (title,pipeline_id,stage_id,owner_id,visibility_level,currency)
         SELECT 'Scoped entrant',$1,$2,$3,'owner','EUR' FROM generate_series(1,$4)`,
        [f.pipelineId, f.stageId, f.userId, MAX_DEAL_COHORT_SCOPE],
      );
      expect(await readObservedDealWinCohorts(h.db, actor, request, signal())).toEqual({
        state: "unavailable",
        reason: "scope-limit",
      });
    });
  });

  test("withholds every cohort when its history payload would be truncated", async () => {
    await withCapture(async (h, f, actor) => {
      const deal = await insertHistoryDeal(h.pool, f);
      await h.pool.query("UPDATE deals SET title=repeat('private evidence ',300000) WHERE id=$1", [
        deal.id,
      ]);
      await h.pool.query("UPDATE deals SET title='Restored short title' WHERE id=$1", [deal.id]);
      expect(await readObservedDealWinCohorts(h.db, actor, request, signal())).toEqual({
        state: "unavailable",
        reason: "history-limit",
      });
    });
  });
});
