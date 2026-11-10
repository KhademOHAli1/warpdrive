import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { applyMigrations } from "@/db/migrate";
import { parseMigrationJournal } from "@/db/migrationAdmission";
import { ledger, migrationFolder } from "@/db/migrationAdmission.test-helpers";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  EXACT_LEGACY_VALUE,
  historySourceRows,
  insertHistoryDeal,
  readCaptureEvents,
  readCaptureHead,
} from "./capture.test-helpers";

const proposalUrl = new URL(
  "../../../../docs/analytics/history-capture-proposal.sql",
  import.meta.url,
);
const rollbackProbe = "warpdrive_test_only_history_rehearsal_abort";
const signal = () => AbortSignal.timeout(30_000);

function runnerBody(source: string): string {
  // Retain every byte except the two outer SQL commands. PL/pgSQL blocks remain intact.
  const wrapped =
    /^((?:--[^\r\n]*\r?\n|\r?\n)*)BEGIN;(\r?\n[\s\S]*\r?\n)COMMIT;((?:\r?\n)*)$/u.exec(source);
  if (wrapped === null) throw new TypeError("Expected the standalone proposal transaction wrapper");
  const [, preamble = "", body = "", trailing = ""] = wrapped;
  return `${preamble}${body}${trailing}`;
}

async function appendRehearsalEntry(folder: string, failLate: boolean) {
  const journalPath = join(folder, "meta/_journal.json");
  const raw: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  const journal = parseMigrationJournal(raw);
  if (!journal.ok) throw new TypeError(journal.error);
  const previous = journal.value.at(-1);
  if (previous === undefined) throw new TypeError("Expected a genuine canonical prefix");
  const prefixLength = journal.value.length;
  // The runner needs a contiguous index. This tag exists only in the disposable folder.
  const entry = {
    idx: prefixLength,
    when: previous.when + 1,
    version: previous.version,
    tag: `${String(prefixLength).padStart(4, "0")}_test_only_analytics_history_rehearsal`,
    breakpoints: true,
  };
  const body = runnerBody(await readFile(proposalUrl, "utf8"));
  // A separate runner statement fails after all the proposal DDL and baselines execute.
  const source = failLate
    ? `${body}\n--> statement-breakpoint\nSELECT pg_catalog.${rollbackProbe}();\n`
    : body;
  await writeFile(join(folder, `${entry.tag}.sql`), source);
  await writeFile(
    journalPath,
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [...journal.value, entry],
    }),
  );
  return {
    prefixLength,
    when: String(entry.when),
    hash: createHash("sha256").update(source).digest("hex"),
  };
}

async function captureObjects(h: TestDb) {
  return (
    await h.pool.query(`
    SELECT pg_catalog.to_regclass('public.analytics_history_coverage')::text AS coverage,
      pg_catalog.to_regclass('public.analytics_history_events')::text AS events,
      pg_catalog.to_regclass('public.analytics_history_heads')::text AS heads,
      pg_catalog.to_regclass('public.analytics_report_snapshots')::text AS snapshots,
      pg_catalog.to_regprocedure('public.analytics_capture_row_change()')::text AS capture,
      EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid IN ('public.deals'::regclass, 'public.stages'::regclass, 'public.pipelines'::regclass)
          AND t.tgname IN ('analytics_deals_capture', 'analytics_stages_capture', 'analytics_pipelines_capture',
            'analytics_deals_truncate_guard', 'analytics_stages_truncate_guard', 'analytics_pipelines_truncate_guard'))
        AS "sourceTriggers"
  `)
  ).rows;
}

const emptyCapture = [
  {
    coverage: null,
    events: null,
    heads: null,
    snapshots: null,
    capture: null,
    sourceTriggers: false,
  },
];

async function populateSource(h: TestDb) {
  const ids = {
    userId: randomUUID(),
    pipelineId: randomUUID(),
    stageId: randomUUID(),
    otherStageId: randomUUID(),
  };
  await h.pool.query(
    "INSERT INTO public.users(id,email,name) VALUES ($1,$2,'History rehearsal owner')",
    [ids.userId, `history-rehearsal-${ids.userId}@example.test`],
  );
  await h.pool.query(
    "INSERT INTO public.pipelines(id,name) VALUES ($1,'Legacy history rehearsal')",
    [ids.pipelineId],
  );
  await h.pool.query(
    `INSERT INTO public.stages(id,pipeline_id,name,"order",rotting_days)
     VALUES ($1,$3,'Existing qualification',0,14),($2,$3,'Existing proposal',1,21)`,
    [ids.stageId, ids.otherStageId, ids.pipelineId],
  );
  return insertHistoryDeal(h.pool, ids);
}

async function prepareRehearsal(h: TestDb, folder: string, failLate: boolean) {
  expect(await captureObjects(h)).toEqual(emptyCapture);
  const candidate = await appendRehearsalEntry(folder, failLate);
  const deal = await populateSource(h);
  const beforeSources = await historySourceRows(h.pool);
  const beforeReceipts = await ledger(h);
  expect(beforeReceipts).toHaveLength(candidate.prefixLength);
  return { folder, candidate, dealId: deal.id, beforeSources, beforeReceipts };
}

async function withRehearsal(
  failLate: boolean,
  run: (h: TestDb, fixture: Awaited<ReturnType<typeof prepareRehearsal>>) => Promise<void>,
) {
  // The shared integration harness applies the actual current journal/SQL to its template.
  // Clone that exact prefix and use the canonical test helper's temporary copy for the runner.
  const copy = await migrationFolder();
  try {
    const h = await makeTestDb();
    h.pool.options.statement_timeout = 5_000;
    h.pool.options.lock_timeout = 2_000;
    try {
      await run(h, await prepareRehearsal(h, copy.folder, failLate));
    } finally {
      await h.close();
    }
  } finally {
    await copy.dispose();
  }
}

async function witnessTypes(h: TestDb) {
  return (
    await h.pool.query(`
    SELECT c.relname AS relation, a.attname AS "column", tn.nspname AS "typeSchema", t.typname AS "typeName"
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace rn ON rn.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
    WHERE rn.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      AND (c.relname, a.attname) IN (
        ('analytics_history_coverage','baseline_snapshot'),
        ('analytics_history_events','observation_snapshot'),
        ('analytics_report_snapshots','transaction_snapshot')
      )
    ORDER BY c.relname
  `)
  ).rows;
}

async function coverage(h: TestDb) {
  return (
    await h.pool.query<{ activationId: string; transactionId: string; snapshot: string }>(`
    SELECT activation_id::text AS "activationId", activation_transaction_id AS "transactionId",
      baseline_snapshot::text AS snapshot FROM public.analytics_history_coverage
  `)
  ).rows;
}

// Disposable native rehearsal. The synthetic tag and receipt establish no migration admission.
test("upgrades the populated canonical prefix with native snapshot witnesses and reruns idempotently", async () => {
  await withRehearsal(false, async (h, fixture) => {
    // The runner searches public before pg_catalog. This disposable domain exposes any
    // unqualified witness type in the proposal's table definitions.
    await h.pool.query("CREATE DOMAIN public.pg_snapshot AS pg_catalog.text");
    expect(await applyMigrations(h.db, signal(), fixture.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await historySourceRows(h.pool)).toEqual(fixture.beforeSources);
    const upgradedReceipts = await ledger(h);
    expect(upgradedReceipts).toHaveLength(fixture.candidate.prefixLength + 1);
    expect(upgradedReceipts.slice(0, -1)).toEqual(fixture.beforeReceipts);
    expect(upgradedReceipts.at(-1)).toMatchObject({
      hash: fixture.candidate.hash,
      created_at: fixture.candidate.when,
    });
    expect(await witnessTypes(h)).toEqual([
      {
        relation: "analytics_history_coverage",
        column: "baseline_snapshot",
        typeSchema: "pg_catalog",
        typeName: "pg_snapshot",
      },
      {
        relation: "analytics_history_events",
        column: "observation_snapshot",
        typeSchema: "pg_catalog",
        typeName: "pg_snapshot",
      },
      {
        relation: "analytics_report_snapshots",
        column: "transaction_snapshot",
        typeSchema: "pg_catalog",
        typeName: "pg_snapshot",
      },
    ]);

    const activationRows = await coverage(h);
    expect(activationRows).toHaveLength(1);
    const activation = activationRows[0];
    if (activation === undefined) throw new Error("Expected one rehearsal activation");
    const baselines = await readCaptureEvents(h.pool);
    expect(baselines.map((event) => `${event.entityKind}:${event.entityId}`).sort()).toEqual(
      fixture.beforeSources.map((row) => `${row.kind}:${row.id}`).sort(),
    );
    for (const event of baselines) {
      expect(event).toMatchObject({
        activationId: activation.activationId,
        eventKind: "baseline",
        beforeState: null,
        transactionId: activation.transactionId,
        observationSnapshot: activation.snapshot,
      });
    }
    const original = baselines.find(
      (event) => event.entityKind === "deal" && event.entityId === fixture.dealId,
    );
    if (original === undefined) throw new Error("Expected a populated deal baseline");
    expect(original.afterState?.value).toBe(EXACT_LEGACY_VALUE);

    await h.pool.query("UPDATE public.deals SET value=$2::numeric WHERE id=$1", [
      fixture.dealId,
      "99999999999999.1235",
    ]);
    const updated = await readCaptureEvents(h.pool, "deal", fixture.dealId);
    expect(updated).toHaveLength(2);
    expect(updated[0]).toEqual(original);
    expect(updated[1]).toMatchObject({
      eventKind: "update",
      activationId: activation.activationId,
      incarnationId: original.incarnationId,
      beforeState: original.afterState,
      afterState: { value: "99999999999999.1235" },
    });
    expect(await readCaptureHead(h.pool, "deal", fixture.dealId)).toMatchObject({
      active: true,
      incarnationId: original.incarnationId,
      lastEventOrdinal: updated[1]?.ordinal,
    });

    const eventsBeforeRerun = await readCaptureEvents(h.pool);
    expect(eventsBeforeRerun).toHaveLength(baselines.length + 1);
    const sourcesBeforeRerun = await historySourceRows(h.pool);
    expect(await applyMigrations(h.db, signal(), fixture.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(upgradedReceipts);
    expect(await coverage(h)).toEqual(activationRows);
    expect(await readCaptureEvents(h.pool)).toEqual(eventsBeforeRerun);
    expect(await historySourceRows(h.pool)).toEqual(sourcesBeforeRerun);
  });
});

test("rolls back the proposal and leaves the prior ledger intact after a deliberate late statement failure", async () => {
  await withRehearsal(true, async (h, fixture) => {
    expect(await applyMigrations(h.db, signal(), fixture.folder)).toMatchObject({
      ok: false,
      error: expect.stringContaining(rollbackProbe),
    });
    expect(await captureObjects(h)).toEqual(emptyCapture);
    expect(await historySourceRows(h.pool)).toEqual(fixture.beforeSources);
    expect(await ledger(h)).toEqual(fixture.beforeReceipts);
  });
});
