import { afterEach, beforeEach, expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { makeTestDb } from "@/test/db";
import { whileProviderBlocked } from "./calendarCatalog.gate-helpers";
import {
  catalogTransport,
  discoverCatalog,
  forbidProviderNetwork,
  initialCatalogCalendar,
  readCatalog,
  readyCatalogFixture,
} from "./calendarCatalog.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
let network: ReturnType<typeof forbidProviderNetwork>;
beforeEach(async () => {
  ctx = await makeTestDb();
  network = forbidProviderNetwork();
});
afterEach(async () => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    await ctx.close();
  }
});

async function publication(accountId: string) {
  const result = await ctx.pool.query<{
    published_run_id: string | null;
    published_generation: number | null;
    revision: number;
    sync_token: string | null;
    discovered_at: Date | null;
  }>(
    `SELECT published_run_id, published_generation, revision, sync_token, discovered_at
     FROM calendar_provider_catalog_states WHERE account_id = $1`,
    [accountId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

it("aborting during a later page propagates AbortError and preserves the previous complete publication", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const before = await publication(fixture.accountId);
  const controller = new AbortController();
  const reason = new DOMException("Synthetic catalog cancellation", "AbortError");
  const running = whileProviderBlocked(
    (transport, deadline) =>
      discoverCatalog(ctx.db, fixture, [], {
        transport,
        signal: AbortSignal.any([deadline, controller.signal]),
      }),
    catalogTransport([
      {
        items: [{ ...initialCatalogCalendar, id: "partial-before-abort" }],
        nextPageToken: "later",
      },
      {
        items: [{ ...initialCatalogCalendar, id: "never-published" }],
        nextSyncToken: "aborted-cursor",
      },
    ]),
    () => {
      controller.abort(reason);
      return Promise.resolve();
    },
    (url) => new URL(url).searchParams.get("pageToken") === "later",
  );
  await expect(running).rejects.toBe(reason);
  expect(await publication(fixture.accountId)).toEqual(before);
  const current = await readCatalog(ctx.db, fixture);
  expect(current.revision).toBe(fixture.catalog.revision);
  expect(current.discoveredAt).toBe(fixture.catalog.discoveredAt);
  expect(current.calendars).toEqual(fixture.catalog.calendars);
});

it("a PostgreSQL rejection after the first 200-row batch rolls back all catalog rows and publication fields", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const before = await publication(fixture.accountId);
  const rowsBefore = await ctx.pool.query<Record<string, unknown>>(
    "SELECT * FROM calendar_provider_calendars WHERE account_id = $1 ORDER BY calendar_id",
    [fixture.accountId],
  );
  await ctx.pool.query(`
    CREATE SEQUENCE catalog_batch_probe MINVALUE 0 START 0;
    CREATE FUNCTION reject_catalog_batch_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.calendar_id = 'reject-after-first-chunk' THEN
        PERFORM setval('catalog_batch_probe',
          (SELECT count(*) FROM calendar_provider_calendars
           WHERE account_id = NEW.account_id AND calendar_id LIKE 'first-chunk-%'), true);
        RAISE EXCEPTION 'synthetic catalog write rejection' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_catalog_batch BEFORE INSERT ON calendar_provider_calendars
      FOR EACH ROW EXECUTE FUNCTION reject_catalog_batch_test();
  `);
  try {
    const entries = Array.from({ length: 200 }, (_, index) => ({
      ...initialCatalogCalendar,
      id: `first-chunk-${String(index).padStart(3, "0")}`,
    }));
    entries.push({ ...initialCatalogCalendar, id: "reject-after-first-chunk" });
    expect(
      await discoverCatalog(ctx.db, fixture, [
        { items: entries, nextSyncToken: "must-not-commit" },
      ]),
    ).toMatchObject({ ok: false, error: { kind: "storage" } });
    // Sequences survive rollback, proving the rejection ran after 200 tentative writes.
    const probe = await ctx.pool.query<{ last_value: string }>(
      "SELECT last_value FROM catalog_batch_probe",
    );
    expect(Number(probe.rows[0]?.last_value)).toBe(200);
    expect(await publication(fixture.accountId)).toEqual(before);
    const rowsAfter = await ctx.pool.query<Record<string, unknown>>(
      "SELECT * FROM calendar_provider_calendars WHERE account_id = $1 ORDER BY calendar_id",
      [fixture.accountId],
    );
    expect(rowsAfter.rows).toEqual(rowsBefore.rows);
    expect((await readCatalog(ctx.db, fixture)).calendars).toEqual(fixture.catalog.calendars);
  } finally {
    await ctx.pool.query(`
      DROP TRIGGER IF EXISTS reject_catalog_batch ON calendar_provider_calendars;
      DROP FUNCTION IF EXISTS reject_catalog_batch_test();
      DROP SEQUENCE IF EXISTS catalog_batch_probe;
    `);
  }
});

it("a publisher returning after its persisted request deadline cannot replace the previous catalog", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const before = await publication(fixture.accountId);
  let now = new Date();
  const result = await whileProviderBlocked(
    (transport, deadline) =>
      discoverCatalog(ctx.db, fixture, [], {
        transport,
        signal: deadline,
        now: () => now,
      }),
    catalogTransport([
      { items: [{ ...initialCatalogCalendar, summary: "Expired run" }], nextSyncToken: "expired" },
    ]),
    async () => {
      const request = await ctx.pool.query<{ request_expires_at: Date }>(
        "SELECT request_expires_at FROM calendar_provider_catalog_states WHERE account_id = $1",
        [fixture.accountId],
      );
      const expiresAt = request.rows[0]?.request_expires_at;
      if (expiresAt === undefined)
        throw new AppError(ERROR_IDS.DB_INVARIANT, "catalog request deadline was not persisted");
      now = new Date(expiresAt.getTime() + 1);
    },
  );
  expect(result.ok).toBe(false);
  expect(await publication(fixture.accountId)).toEqual(before);
  const current = await readCatalog(ctx.db, fixture);
  expect(current.revision).toBe(fixture.catalog.revision);
  expect(current.discoveredAt).toBe(fixture.catalog.discoveredAt);
  expect(current.calendars).toEqual(fixture.catalog.calendars);
});
