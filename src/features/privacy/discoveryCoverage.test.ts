import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import * as schema from "@/db/schema";
import { checkDiscoveryCoverage, DISCOVERY_COVERAGE } from "./discoveryCoverage";
import { DISCOVERY_ADAPTER_TABLES } from "./discoveryTypes";

test("P07B: every declared application table has an explicit candidate adapter or blocker", () => {
  const tables = Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((value) => getTableName(value));
  expect(tables.length).toBeGreaterThanOrEqual(93);
  expect(checkDiscoveryCoverage(tables)).toEqual({ ok: true, missing: [], invalid: [] });
  expect(
    DISCOVERY_COVERAGE.filter((entry) => entry.status === "supported").map((entry) => entry.store),
  ).toEqual([...DISCOVERY_ADAPTER_TABLES]);
  expect(checkDiscoveryCoverage([...tables, "new_sensitive_store"])).toEqual({
    ok: false,
    missing: ["new_sensitive_store"],
    invalid: [],
  });
});
