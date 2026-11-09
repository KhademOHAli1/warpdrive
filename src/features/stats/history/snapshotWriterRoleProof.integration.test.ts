import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { makeTestDb } from "@/test/db";
import { prepareHistoryCapture } from "./capture.test-helpers";
import { writeCurrentInventorySnapshot } from "./inventorySnapshotRepository";

function roleName(prefix: "runtime" | "writer"): string {
  // The interpolated identifier is generated entirely by the fixture.
  return `analytics_test_${prefix}_${randomUUID().replaceAll("-", "")}`;
}

const copyAtCurrentCut = `
  INSERT INTO public.analytics_report_snapshots (
    activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
    calendar,cutoff_observed_at,transaction_snapshot,records,created_by
  ) SELECT activation_id,kind,definition_version,report_definition,scope,currency,time_zone,
    calendar,pg_catalog.statement_timestamp(),pg_catalog.pg_current_snapshot(),records,created_by
  FROM public.analytics_report_snapshots WHERE id=$1::uuid
  RETURNING id::text
`;

async function refusesPrivilege(
  client: PoolClient,
  role: string,
  operation: () => Promise<unknown>,
) {
  await client.query("SAVEPOINT before_role_probe");
  try {
    await client.query(`SET LOCAL ROLE "${role}"`);
    await expect(operation()).rejects.toMatchObject({ code: "42501" });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT before_role_probe");
    await client.query("RELEASE SAVEPOINT before_role_probe");
  }
}

// This fixture checks a privilege layout in one disposable transaction. It does not
// provision deployment roles, authenticate a writer's caller or run the app under it.
test("separates runtime INSERT, trusted snapshot INSERT and source DML", async () => {
  const h = await makeTestDb();
  try {
    const f = await prepareHistoryCapture(h);
    const template = await writeCurrentInventorySnapshot(
      h.db,
      { id: f.userId, type: "regular", isActive: true, groupIds: new Set(), flags: new Set() },
      { pipelineId: f.pipelineId, currency: "EUR" },
      AbortSignal.timeout(10_000),
    );
    if (template.state !== "created")
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Expected a snapshot for the role probe");

    const runtime = roleName("runtime");
    const writer = roleName("writer");
    const client = await h.pool.connect();
    try {
      await client.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'",
      );
      await client.query(`CREATE ROLE "${runtime}" NOLOGIN NOSUPERUSER NOINHERIT`);
      await client.query(`CREATE ROLE "${writer}" NOLOGIN NOSUPERUSER NOINHERIT`);
      await client.query(`GRANT USAGE ON SCHEMA public TO "${runtime}", "${writer}"`);
      await client.query(
        `GRANT SELECT ON public.analytics_report_snapshots TO "${runtime}", "${writer}"`,
      );
      await client.query(`GRANT SELECT ON public.analytics_history_events TO "${writer}"`);
      await client.query(`GRANT INSERT ON public.analytics_report_snapshots TO "${writer}"`);

      await refusesPrivilege(client, runtime, () =>
        client.query(copyAtCurrentCut, [template.snapshotId]),
      );
      await refusesPrivilege(client, writer, () =>
        client.query("UPDATE public.deals SET title='Role probe' WHERE id=$1::uuid", [f.dealId]),
      );
      await refusesPrivilege(client, writer, () =>
        client.query(
          "ALTER TABLE public.analytics_report_snapshots DISABLE TRIGGER analytics_snapshots_insert_guard",
        ),
      );
      await client.query(`SET LOCAL ROLE "${writer}"`);
      const inserted = await client.query<{ id: string }>(copyAtCurrentCut, [template.snapshotId]);
      expect(inserted.rows).toHaveLength(1);
      expect(inserted.rows[0]?.id).not.toBe(template.snapshotId);
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    const roles = await h.pool.query(
      "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY($1::name[])",
      [[runtime, writer]],
    );
    expect(roles.rows).toEqual([]);
  } finally {
    await h.close();
  }
});
