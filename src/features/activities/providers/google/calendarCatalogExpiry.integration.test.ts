import { afterEach, beforeEach, expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import {
  forbidProviderNetwork,
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

it("an expired refreshing run reads as retryable error without modifying the stored run or prior publication", async () => {
  const fixture = await readyCatalogFixture(ctx.db);
  const changed = await ctx.pool.query(
    `UPDATE calendar_provider_catalog_states
     SET status = 'refreshing', latest_run_id = gen_random_uuid(),
         request_expires_at = now() - interval '1 second'
     WHERE account_id = $1`,
    [fixture.accountId],
  );
  expect(changed.rowCount).toBe(1);
  const listed = await readCatalog(ctx.db, fixture);
  const stored = await ctx.pool.query<{ status: string }>(
    "SELECT status FROM calendar_provider_catalog_states WHERE account_id = $1",
    [fixture.accountId],
  );
  expect(stored.rows[0]?.status).toBe("refreshing");
  expect(listed.revision).toBe(fixture.catalog.revision);
  expect(listed.calendars).toEqual(fixture.catalog.calendars);
  expect(listed.discoveredAt).toBe(fixture.catalog.discoveredAt);
  expect(listed.status).toBe("error");
});
