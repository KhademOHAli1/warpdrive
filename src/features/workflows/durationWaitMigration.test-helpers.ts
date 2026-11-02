import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type MigrationJournalEntry, parseMigrationJournal } from "@/db/migrationAdmission";
import { canonicalFolder } from "@/db/migrationAdmission.test-helpers";
import type { TestDb } from "@/test/db";

const PREFIX_COUNT = 98;
const PREFIX_DIGEST = "407e0d5ea137fe8649b4fbe098f25c315e72a2cf28a2283eefa73a35c2a0e530";
const CANDIDATE_HASH = "ba65deaf21f4f5c38cd7414afd851f91a14b5c2aed3e758bb75b36b56b3a63ef";
const CANDIDATE_TAG = "0098_workflow_duration_wait";
const CANDIDATE_WHEN = 1793563011200;
const journalEnvelope = z.strictObject({
  version: z.literal("7"),
  dialect: z.literal("postgresql"),
  entries: z
    .array(
      z.strictObject({
        idx: z.number().int().nonnegative().safe(),
        version: z.literal("7"),
        when: z.number().int().positive().safe(),
        tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/u),
        breakpoints: z.boolean(),
      }),
    )
    .min(PREFIX_COUNT + 1),
});
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

// Freeze both real historical prefixes so later canonical migrations cannot silently
// enter this 0098 qualification. Preserve their journal identities and exact SQL bytes.
export async function durationMigrationFixtures(signal: AbortSignal) {
  const owned = await mkdtemp(join(tmpdir(), "warpdrive-duration-upgrade-"));
  try {
    const raw = journalEnvelope.parse(
      JSON.parse(
        await readFile(join(canonicalFolder, "meta/_journal.json"), { encoding: "utf8", signal }),
      ),
    );
    const parsed = parseMigrationJournal(raw);
    if (!parsed.ok || parsed.value.length < PREFIX_COUNT + 1)
      throw new TypeError("Missing canonical duration-wait prefix");
    const baseline = parsed.value.slice(0, PREFIX_COUNT);
    const candidate = parsed.value[PREFIX_COUNT];
    if (
      candidate === undefined ||
      candidate.idx !== PREFIX_COUNT ||
      candidate.tag !== CANDIDATE_TAG ||
      candidate.when !== CANDIDATE_WHEN
    )
      throw new TypeError("Missing exact canonical 0098 duration-wait migration");
    const baselineFolder = join(owned, "baseline");
    const candidateFolder = join(owned, "candidate");
    await mkdir(join(baselineFolder, "meta"), { recursive: true });
    await mkdir(join(candidateFolder, "meta"), { recursive: true });
    const sources: Array<MigrationJournalEntry & { sha256: string }> = [];
    for (const entry of baseline) {
      signal.throwIfAborted();
      const body = await readFile(join(canonicalFolder, `${entry.tag}.sql`), { signal });
      sources.push({
        idx: entry.idx,
        version: entry.version,
        when: entry.when,
        tag: entry.tag,
        breakpoints: entry.breakpoints,
        sha256: hash(body),
      });
      await writeFile(join(baselineFolder, `${entry.tag}.sql`), body, { signal });
      await writeFile(join(candidateFolder, `${entry.tag}.sql`), body, { signal });
    }
    if (hash(JSON.stringify(sources)) !== PREFIX_DIGEST)
      throw new TypeError("Pre-0098 source prefix differs from the reviewed fixture");
    const body = await readFile(join(canonicalFolder, `${candidate.tag}.sql`), { signal });
    if (hash(body) !== CANDIDATE_HASH) throw new TypeError("0098 SQL body differs from review");
    await writeFile(join(candidateFolder, `${candidate.tag}.sql`), body, { signal });
    await writeFile(
      join(baselineFolder, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: baseline,
      }),
      { signal },
    );
    await writeFile(
      join(candidateFolder, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: parsed.value.slice(0, PREFIX_COUNT + 1),
      }),
      { signal },
    );
    signal.throwIfAborted();
    return {
      baselineFolder,
      candidateFolder,
      sources,
      candidateHash: CANDIDATE_HASH,
      candidateWhen: candidate.when,
      dispose: () => rm(owned, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(owned, { recursive: true, force: true });
    throw error;
  }
}

export const LEGACY_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
type LegacyStatus = (typeof LEGACY_STATUSES)[number];
const stamp = "2026-10-01T10:00:00.000Z";

type DurationSeedQuery = (text: string, values: unknown[]) => Promise<void>;

async function seedDurationSteps(
  query: DurationSeedQuery,
  run: string,
  status: LegacyStatus,
  steps: Array<{ node: string; output: Record<string, string> }>,
  historicalStep: string,
  simulated: boolean,
) {
  for (const step of steps)
    await query(
      "INSERT INTO workflow_steps(id,run_id,node_id,simulated,output,completed_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        status === "queued" && step.node === "start" ? historicalStep : randomUUID(),
        run,
        step.node,
        simulated,
        step.output,
        stamp,
      ],
    );
}

export async function seedDurationUpgradeData(h: TestDb, signal: AbortSignal) {
  const owner = randomUUID();
  const workflow = randomUUID();
  const otherWorkflow = randomUUID();
  const historicalVersion = randomUUID();
  const publishedVersion = randomUUID();
  const pipeline = randomUUID();
  const stage = randomUUID();
  const deal = randomUUID();
  const activity = randomUUID();
  const query = async (text: string, values: unknown[]) => {
    await h.pool.query(text, values);
    signal.throwIfAborted();
  };
  await query("INSERT INTO users(id,email,name,is_admin) VALUES($1,$2,'علی آزمون',true)", [
    owner,
    `duration-upgrade-${owner}@example.invalid`,
  ]);
  await query(
    "INSERT INTO auth_users(id,email,name,email_verified) SELECT id,email,name,true FROM users WHERE id=$1",
    [owner],
  );
  await query("INSERT INTO pipelines(id,name) VALUES($1,'Migration pipeline')", [pipeline]);
  await query("INSERT INTO stages(id,pipeline_id,name) VALUES($1,$2,'Proposal')", [
    stage,
    pipeline,
  ]);
  await query(
    "INSERT INTO deals(id,title,pipeline_id,stage_id,owner_id,visibility_level,value,currency) VALUES($1,'Kunde / مشتری',$2,$3,$4,'owner',1250.75,'EUR')",
    [deal, pipeline, stage, owner],
  );
  const task = await h.pool.query<{ id: string }>("SELECT id FROM activity_types WHERE key='task'");
  signal.throwIfAborted();
  const type = task.rows[0];
  if (type === undefined) throw new TypeError("Missing migrated task activity type");
  await query(
    "INSERT INTO activities(id,type_id,subject,owner_id,assignee_id,deal_id,due_at) VALUES($1,$2,'پیگیری مشتری',$3,$3,$4,$5)",
    [activity, type.id, owner, deal, stamp],
  );
  const definition = {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Follow up",
        config: {
          subject: { kind: "value", value: "پیگیری مشتری" },
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
  await query(
    "INSERT INTO workflows(id,owner_id,name,draft) VALUES($1,$3,'Follow up',$4),($2,$3,'Other workflow',$4)",
    [workflow, otherWorkflow, owner, definition],
  );
  await query(
    "INSERT INTO workflow_versions(id,workflow_id,number,name,definition,published_by) VALUES($1,$3,1,'Historical version',$4,$5),($2,$3,2,'Published version',$4,$5)",
    [historicalVersion, publishedVersion, workflow, definition, owner],
  );
  await query("UPDATE workflows SET published_number=2,active=true WHERE id=$1", [workflow]);
  const cursors: Record<LegacyStatus, string | null> = {
    queued: "read",
    running: "task",
    succeeded: null,
    failed: "read",
    cancelled: "task",
  };
  const runs: Record<LegacyStatus, string> = {
    queued: randomUUID(),
    running: randomUUID(),
    succeeded: randomUUID(),
    failed: randomUUID(),
    cancelled: randomUUID(),
  };
  const historicalStep = randomUUID();
  for (const status of LEGACY_STATUSES) {
    const run = runs[status];
    const simulated = status === "failed";
    const steps: Array<{ node: string; output: Record<string, string> }> = [
      { node: "start", output: { recordId: deal } },
    ];
    if (status !== "queued" && status !== "failed")
      steps.push({
        node: "read",
        output: { id: deal, title: "Kunde / مشتری", value: "1250.75", currency: "EUR" },
      });
    if (status === "succeeded") steps.push({ node: "task", output: { id: activity } });
    const outputs = Object.fromEntries(steps.map((step) => [step.node, step.output]));
    // Raw legacy columns avoid the current ORM returning projection's resume_at.
    await query(
      "INSERT INTO workflow_runs(id,workflow_id,version_id,actor_id,request_key,mode,status,trigger,outputs,next_node_id,cancelled_by,cancelled_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)",
      [
        run,
        workflow,
        historicalVersion,
        owner,
        randomUUID(),
        simulated ? "simulation" : "live",
        status,
        { recordId: deal },
        outputs,
        cursors[status],
        status === "cancelled" ? owner : null,
        status === "cancelled" ? stamp : null,
        stamp,
      ],
    );
    await seedDurationSteps(query, run, status, steps, historicalStep, simulated);
  }
  return {
    owner,
    workflow,
    otherWorkflow,
    historicalVersion,
    publishedVersion,
    runs,
    historicalStep,
  };
}

const businessTables = [
  "users",
  "auth_users",
  "pipelines",
  "stages",
  "deals",
  "activity_types",
  "activities",
  "workflows",
  "workflow_versions",
  "workflow_runs",
  "workflow_steps",
] as const;

export async function durationBusinessSnapshot(h: TestDb, after: boolean, signal: AbortSignal) {
  const rows = await Promise.all(
    businessTables.map(async (table) => {
      const value =
        after && table === "workflow_runs" ? "to_jsonb(t) - 'resume_at'" : "to_jsonb(t)";
      return (
        await h.pool.query<{ value: unknown }>(
          `SELECT ${value} AS value FROM public.${table} t ORDER BY id`,
        )
      ).rows;
    }),
  );
  signal.throwIfAborted();
  return rows;
}

export async function durationForeignKeys(h: TestDb, signal: AbortSignal) {
  const rows = (
    await h.pool.query<Record<string, unknown>>(`
    SELECT conrelid::regclass::text AS table_name, conname,
      pg_get_constraintdef(oid, false) AS definition, convalidated,
      condeferrable, condeferred, confupdtype, confdeltype
    FROM pg_constraint WHERE contype='f' AND conrelid IN (
      'public.workflows'::regclass, 'public.workflow_versions'::regclass,
      'public.workflow_runs'::regclass, 'public.workflow_steps'::regclass,
      'public.deals'::regclass, 'public.activities'::regclass)
    ORDER BY table_name, conname`)
  ).rows;
  signal.throwIfAborted();
  return rows;
}

export async function durationWaitDueIndex(h: TestDb, signal: AbortSignal) {
  const rows = (
    await h.pool.query<Record<string, unknown>>(`
    SELECT i.indexrelid::text AS index_oid, c.relname AS name, am.amname AS method,
      i.indisunique, i.indisvalid, i.indisready, i.indnkeyatts, i.indnatts,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        ORDER BY k.n) AS keys,
      pg_get_expr(i.indpred, i.indrelid, false) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      JOIN pg_am am ON am.oid=c.relam
    WHERE i.indrelid='public.workflow_runs'::regclass
      AND c.relname='workflow_runs_wait_due_idx'`)
  ).rows;
  signal.throwIfAborted();
  return rows;
}
