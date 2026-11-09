import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { expect, test } from "vitest";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { convertDealToLead } from "@/features/deal-workspace/convertToLead";
import { convertLead } from "@/features/leads/leadConvert";
import { insertLead, session } from "@/features/leads/leadConvert.test-helpers";
import { makeTestDb, type TestDb } from "@/test/db";

const proposal = new URL(
  "../../../../docs/analytics/lead-link-capture-proposal.sql",
  import.meta.url,
);
const signal = () => AbortSignal.timeout(10_000);

async function installCapture(h: TestDb) {
  const sql = await readFile(proposal, "utf8");
  const client = await h.pool.connect();
  try {
    await client.query("SET statement_timeout='5000ms'; SET lock_timeout='2000ms'");
    await client.query(sql);
  } finally {
    try {
      await client.query("ROLLBACK; RESET statement_timeout; RESET lock_timeout");
    } finally {
      client.release();
    }
  }
}

async function convert(
  h: TestDb,
  ownerId: string,
  pipelineId: string,
  lead: { id: string; updatedAt: Date },
) {
  const result = await convertLead(
    h.db,
    session(ownerId),
    { leadId: lead.id, pipelineId, expectedUpdatedAt: lead.updatedAt.toISOString() },
    signal(),
  );
  if (!result.ok) throw new Error(`Native lead conversion failed: ${result.error.id}`);
  return result.value.dealId;
}

async function observations(db: TestDb["pool"] | PoolClient) {
  const result = await db.query<{
    leadId: string;
    beforeDealId: string | null;
    afterDealId: string | null;
    transactionId: string;
    visible: boolean;
    observedAfterActivation: boolean;
  }>(
    `SELECT e.lead_id AS "leadId", e.before_deal_id AS "beforeDealId", e.after_deal_id AS "afterDealId",
            e.transaction_id::text AS "transactionId",
            pg_catalog.pg_visible_in_snapshot(e.transaction_id, pg_catalog.pg_current_snapshot()) AS visible,
            e.observed_at >= c.activated_at AS "observedAfterActivation"
     FROM public.analytics_lead_link_events e JOIN public.analytics_lead_link_capture c USING (activation_id)
     ORDER BY e.ordinal`,
  );
  return result.rows;
}

test("observes the actual forward converter without claiming a legacy or reverse transition", async () => {
  const h = await makeTestDb();
  try {
    const owner = await seedUser(h.db);
    const { pipeline } = await seedPipelineWithStages(h.db, ["Initial"]);
    const legacy = await insertLead(h.db, owner.id);
    const legacyDealId = await convert(h, owner.id, pipeline.id, legacy);
    await installCapture(h);
    await insertLead(h.db, owner.id, { convertedDealId: legacyDealId });
    expect(await observations(h.pool)).toEqual([]);

    const lead = await insertLead(h.db, owner.id);
    const dealId = await convert(h, owner.id, pipeline.id, lead);
    expect(await observations(h.pool)).toEqual([
      {
        leadId: lead.id,
        beforeDealId: null,
        afterDealId: dealId,
        transactionId: expect.stringMatching(/^\d+$/u),
        visible: true,
        observedAfterActivation: true,
      },
    ]);
    await h.pool.query(
      "UPDATE public.leads SET title='Renamed', converted_deal_id=converted_deal_id WHERE id=$1",
      [lead.id],
    );
    const { rows } = await h.pool.query<{ updatedAt: Date }>(
      'SELECT updated_at AS "updatedAt" FROM public.deals WHERE id=$1',
      [dealId],
    );
    const deal = rows[0];
    if (deal === undefined) throw new Error("Expected the native destination deal");
    const reverse = await convertDealToLead(
      h.db,
      {
        id: owner.id,
        type: "regular",
        isActive: true,
        groupIds: new Set(),
        flags: new Set(["deal.create", "deal.edit_own"]),
      },
      { dealId, expectedUpdatedAt: deal.updatedAt.toISOString() },
      signal(),
    );
    if (!reverse.ok) throw new Error(`Native deal conversion failed: ${reverse.error.id}`);
    const { rows: returned } = await h.pool.query<{
      id: string;
      dealId: string | null;
      updatedAt: Date;
    }>(
      'SELECT id, converted_deal_id AS "dealId", updated_at AS "updatedAt" FROM public.leads WHERE id=$1',
      [reverse.value.leadId],
    );
    expect(returned).toMatchObject([{ id: reverse.value.leadId, dealId: null }]);
    expect(reverse.value.leadId).not.toBe(lead.id);
    expect(await observations(h.pool)).toHaveLength(1);
    const newLead = returned[0];
    if (newLead === undefined) throw new Error("Expected the reverse converter to create a lead");
    const nextDealId = await convert(h, owner.id, pipeline.id, newLead);
    expect(await observations(h.pool)).toMatchObject([
      { leadId: lead.id, beforeDealId: null, afterDealId: dealId },
      { leadId: newLead.id, beforeDealId: null, afterDealId: nextDealId },
    ]);
  } finally {
    await h.close();
  }
});

test("rolls back with the source and records repeated writes at one native transaction", async () => {
  const h = await makeTestDb();
  try {
    const owner = await seedUser(h.db);
    const { pipeline } = await seedPipelineWithStages(h.db, ["Initial"]);
    const legacy = await insertLead(h.db, owner.id);
    const dealId = await convert(h, owner.id, pipeline.id, legacy);
    const lead = await insertLead(h.db, owner.id);
    await installCapture(h);
    const client = await h.pool.connect();
    try {
      for (const disposition of ["ROLLBACK", "COMMIT"]) {
        await client.query(
          "BEGIN; SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'",
        );
        await client.query("UPDATE public.leads SET converted_deal_id=$2 WHERE id=$1", [
          lead.id,
          dealId,
        ]);
        await client.query("UPDATE public.leads SET converted_deal_id=NULL WHERE id=$1", [lead.id]);
        const rows = await observations(client);
        expect(rows).toMatchObject([
          { leadId: lead.id, beforeDealId: null, afterDealId: dealId },
          { leadId: lead.id, beforeDealId: dealId, afterDealId: null },
        ]);
        expect(rows[0]?.transactionId).toBe(rows[1]?.transactionId);
        expect(await observations(h.pool)).toEqual([]);
        await client.query(disposition);
      }
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    expect(await observations(h.pool)).toMatchObject([
      { leadId: lead.id, beforeDealId: null, afterDealId: dealId, visible: true },
      { leadId: lead.id, beforeDealId: dealId, afterDealId: null, visible: true },
    ]);
  } finally {
    await h.close();
  }
});

test("forces a source writer with a preactivation repeatable-read cut to retry", async () => {
  const h = await makeTestDb();
  try {
    const owner = await seedUser(h.db);
    const { pipeline } = await seedPipelineWithStages(h.db, ["Initial"]);
    const legacy = await insertLead(h.db, owner.id);
    const dealId = await convert(h, owner.id, pipeline.id, legacy);
    const lead = await insertLead(h.db, owner.id);
    const setPointer = "UPDATE public.leads SET converted_deal_id=$2 WHERE id=$1";
    const stale = await h.pool.connect();
    try {
      await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await stale.query("SELECT pg_catalog.pg_current_snapshot()");
      await installCapture(h);
      await expect(stale.query(setPointer, [lead.id, dealId])).rejects.toMatchObject({
        code: "40001",
      });
    } finally {
      try {
        await stale.query("ROLLBACK");
      } finally {
        stale.release();
      }
    }
    expect(await observations(h.pool)).toEqual([]);
    await h.pool.query(setPointer, [lead.id, dealId]);
    expect(await observations(h.pool)).toMatchObject([
      { leadId: lead.id, beforeDealId: null, afterDealId: dealId },
    ]);
  } finally {
    await h.close();
  }
});

const eraseSql = `SELECT public.analytics_erase_retained_lead_link_evidence(
  $1::uuid[], $2::uuid[]
)::text AS removed`;

test("erases hard-deleted endpoint history and fences capture for retained-source erasure", async () => {
  const h = await makeTestDb();
  try {
    const owner = await seedUser(h.db);
    const { pipeline } = await seedPipelineWithStages(h.db, ["Initial"]);
    await installCapture(h);
    const lead = await insertLead(h.db, owner.id);
    const destination = await insertLead(h.db, owner.id);
    const retained = await insertLead(h.db, owner.id);
    await convert(h, owner.id, pipeline.id, lead);
    const destinationId = await convert(h, owner.id, pipeline.id, destination);
    const retainedDealId = await convert(h, owner.id, pipeline.id, retained);
    await h.pool.query("DELETE FROM public.leads WHERE id=$1", [lead.id]);
    await h.pool.query("UPDATE public.leads SET converted_deal_id=NULL WHERE id=$1", [
      destination.id,
    ]);
    expect(await observations(h.pool)).toMatchObject([
      { leadId: destination.id, afterDealId: destinationId },
      { leadId: retained.id, afterDealId: retainedDealId },
      { leadId: destination.id, beforeDealId: destinationId, afterDealId: null },
    ]);
    await h.pool.query("DELETE FROM public.deals WHERE id=$1", [destinationId]);
    expect(await observations(h.pool)).toMatchObject([{ leadId: retained.id }]);

    const client = await h.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await expect(client.query(eraseSql, [[retained.id], []])).rejects.toMatchObject({
        code: "55000",
      });
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    await expect(h.pool.query(eraseSql, [[], []])).rejects.toMatchObject({ code: "22023" });
    const first = await h.pool.query<{ removed: string }>(eraseSql, [[retained.id], []]);
    expect(first.rows).toEqual([{ removed: "1" }]);
    const stored = await h.pool.query<{ dealId: string }>(
      'SELECT converted_deal_id AS "dealId" FROM public.leads WHERE id=$1',
      [retained.id],
    );
    expect(stored.rows).toEqual([{ dealId: retainedDealId }]);
    const retry = await h.pool.query<{ removed: string }>(eraseSql, [[], [retainedDealId]]);
    expect(retry.rows).toEqual([{ removed: "0" }]);
    await expect(
      h.pool.query("UPDATE public.analytics_lead_link_capture SET stopped_at=NULL WHERE singleton"),
    ).rejects.toMatchObject({ code: "55000" });
    await h.pool.query("UPDATE public.leads SET converted_deal_id=NULL WHERE id=$1", [retained.id]);
    const later = await insertLead(h.db, owner.id);
    await convert(h, owner.id, pipeline.id, later);
    expect(await observations(h.pool)).toEqual([]);
  } finally {
    await h.close();
  }
});

async function refusesPrivilege(
  client: PoolClient,
  role: string,
  operation: () => Promise<unknown>,
) {
  await client.query("SAVEPOINT lead_link_role_probe");
  try {
    await client.query(`SET LOCAL ROLE "${role}"`);
    await expect(operation()).rejects.toMatchObject({ code: "42501" });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT lead_link_role_probe");
    await client.query("RELEASE SAVEPOINT lead_link_role_probe");
  }
}

test("allows a nonowning source writer to capture through the trigger while keeping evidence private", async () => {
  const h = await makeTestDb();
  try {
    const owner = await seedUser(h.db);
    const { pipeline } = await seedPipelineWithStages(h.db, ["Initial"]);
    const legacy = await insertLead(h.db, owner.id);
    const dealId = await convert(h, owner.id, pipeline.id, legacy);
    const lead = await insertLead(h.db, owner.id);
    await installCapture(h);
    const runtime = `lead_link_test_${randomUUID().replaceAll("-", "")}`;
    const client = await h.pool.connect();
    try {
      await client.query(
        "BEGIN; SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='2000ms'",
      );
      await client.query(`CREATE ROLE "${runtime}" NOLOGIN NOSUPERUSER NOINHERIT`);
      await client.query(`GRANT USAGE ON SCHEMA public TO "${runtime}"`);
      await client.query(
        `GRANT SELECT(id), UPDATE(converted_deal_id) ON public.leads TO "${runtime}"`,
      );
      // The canonical workflow trigger checks these columns as the source writer.
      // No active workflow is present, so it returns without writing a workflow event.
      await client.query(`
        GRANT SELECT(id,published_number,active,archived_at)
          ON public.workflows_v2 TO "${runtime}";
        GRANT SELECT(workflow_id,number,definition)
          ON public.workflow_v2_versions TO "${runtime}";
        GRANT SELECT(run_id,kind,status,config)
          ON public.workflow_v2_waits TO "${runtime}";
        GRANT SELECT(id,workflow_id,status)
          ON public.workflow_v2_runs TO "${runtime}";
      `);
      for (const sql of [
        "SELECT ordinal FROM public.analytics_lead_link_events",
        "INSERT INTO public.analytics_lead_link_events DEFAULT VALUES",
        "DELETE FROM public.analytics_lead_link_events",
        "ALTER TABLE public.leads DISABLE TRIGGER analytics_lead_link_source_change",
      ]) {
        await refusesPrivilege(client, runtime, () => client.query(sql));
      }
      await refusesPrivilege(client, runtime, () => client.query(eraseSql, [[lead.id], []]));
      await client.query(`SET LOCAL ROLE "${runtime}"`);
      const changed = await client.query(
        "UPDATE public.leads SET converted_deal_id=$2 WHERE id=$1",
        [lead.id, dealId],
      );
      expect(changed.rowCount).toBe(1);
      await client.query("RESET ROLE");
      expect(await observations(client)).toMatchObject([{ leadId: lead.id, afterDealId: dealId }]);
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    expect(await observations(h.pool)).toEqual([]);
  } finally {
    await h.close();
  }
});
