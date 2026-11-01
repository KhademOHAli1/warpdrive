import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, test } from "vitest";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import { parseMigrationJournal } from "./migrationAdmission";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "./migrationAdmission.test-helpers";

async function journalEntries(folder: string) {
  const raw: unknown = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
  const result = parseMigrationJournal(raw);
  if (!result.ok) throw new TypeError(result.error);
  return result.value;
}

async function installOriginalPlatformHistory(h: TestDb): Promise<void> {
  const archive = fileURLToPath(
    new URL("../../docs/migration-history/platform-original", import.meta.url),
  );
  const baseline = await mkdtemp(join(tmpdir(), "warpdrive-original-platform-migration-"));
  try {
    await mkdir(join(baseline, "meta"));
    const raw: unknown = JSON.parse(await readFile(join(archive, "_journal.json"), "utf8"));
    const original = parseMigrationJournal(raw);
    if (!original.ok) throw new TypeError(original.error);
    await copyFile(join(archive, "_journal.json"), join(baseline, "meta/_journal.json"));
    for (const entry of original.value) {
      const source = ["0083_integration_connections", "0084_visual_workflows"].includes(entry.tag)
        ? archive
        : canonicalFolder;
      await copyFile(join(source, `${entry.tag}.sql`), join(baseline, `${entry.tag}.sql`));
    }
    // Stock migration establishes the actual foreign history, never admission into main.
    await migrate(h.db, { migrationsFolder: baseline });
  } finally {
    await rm(baseline, { recursive: true, force: true });
  }
}

async function seedOwner(h: TestDb): Promise<string> {
  const owner = randomUUID();
  await h.pool.query(
    "INSERT INTO users (id,email,name,is_admin) VALUES ($1,'migration-owner@example.com','علی آزمون',true)",
    [owner],
  );
  await h.pool.query(
    "INSERT INTO auth_users(id,email,name,email_verified) SELECT id,email,name,true FROM users WHERE id=$1",
    [owner],
  );
  await h.pool.query("INSERT INTO user_preferences(user_id,ui) VALUES ($1,$2)", [
    owner,
    {
      localePreferences: {
        locale: "fa",
        calendar: "gregory",
        numberingSystem: "latn",
        timeZone: "Europe/Berlin",
      },
    },
  ]);
  await h.pool.query(
    "INSERT INTO privacy_cases(kind,created_by,intake_key,intake_digest,metadata_enc) VALUES ('access',$1,'migration-fixture','synthetic-digest',decode('00ff81','hex'))",
    [owner],
  );
  return owner;
}

async function businessSnapshot(h: TestDb) {
  return Promise.all(
    [
      "SELECT * FROM users ORDER BY id",
      "SELECT * FROM auth_users ORDER BY id",
      "SELECT * FROM user_preferences ORDER BY user_id",
      "SELECT * FROM privacy_cases ORDER BY id",
      "SELECT * FROM workflows ORDER BY id",
      "SELECT * FROM workflow_versions ORDER BY id",
      "SELECT * FROM workflow_runs ORDER BY id",
      "SELECT * FROM workflow_steps ORDER BY id",
    ].map(async (query) => (await h.pool.query(query)).rows),
  );
}

async function assertWorkflowConstraints(h: TestDb, owner: string): Promise<void> {
  const workflow = randomUUID();
  const otherWorkflow = randomUUID();
  const version = randomUUID();
  const run = randomUUID();
  const definition = { schemaVersion: 1, nodes: [], edges: [] };
  await h.pool.query(
    "INSERT INTO workflows (id,owner_id,name,draft) VALUES ($1,$3,'Workflow one',$4),($2,$3,'Workflow two',$4)",
    [workflow, otherWorkflow, owner, definition],
  );
  await h.pool.query(
    "INSERT INTO workflow_versions (id,workflow_id,number,name,definition,published_by) VALUES ($1,$2,1,'Version one',$3,$4)",
    [version, workflow, definition, owner],
  );
  await expect(
    h.pool.query("UPDATE workflows SET published_number=2,active=true WHERE id=$1", [workflow]),
  ).rejects.toMatchObject({ code: "23503", constraint: "workflows_published_version_fk" });
  await h.pool.query("UPDATE workflows SET published_number=1,active=true WHERE id=$1", [workflow]);
  await expect(
    h.pool.query(
      "INSERT INTO workflow_runs (workflow_id,version_id,actor_id,request_key,mode,trigger) VALUES ($1,$2,$3,$4,'simulation','{}')",
      [otherWorkflow, version, owner, randomUUID()],
    ),
  ).rejects.toMatchObject({ code: "23503", constraint: "workflow_run_pinned_version_fk" });
  await h.pool.query(
    "INSERT INTO workflow_runs (id,workflow_id,version_id,actor_id,request_key,mode,trigger) VALUES ($1,$2,$3,$4,$5,'simulation','{}')",
    [run, workflow, version, owner, randomUUID()],
  );
  await h.pool.query(
    "INSERT INTO workflow_steps (run_id,node_id,simulated,output) VALUES ($1,'trigger',true,'{}')",
    [run],
  );
  await expect(
    h.pool.query("UPDATE workflow_versions SET definition='{}' WHERE id=$1", [version]),
  ).rejects.toMatchObject({ code: "55000" });
  await expect(
    h.pool.query("DELETE FROM workflow_versions WHERE id=$1", [version]),
  ).rejects.toMatchObject({ code: "55000" });
  expect(
    (await h.pool.query("SELECT definition FROM workflow_versions WHERE id=$1", [version])).rows,
  ).toEqual([{ definition }]);
}

test("guarded clean migrations install integrations and workflows with version safety", async () => {
  const h = await freshMigrationDb();
  try {
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect(
      (await h.pool.query("SELECT to_regclass('public.integration_connections')::text AS name"))
        .rows,
    ).toEqual([{ name: "integration_connections" }]);
    await assertWorkflowConstraints(h, await seedOwner(h));
  } finally {
    await h.close();
  }
});

test("connection upgrade preserves canonical workflow, privacy and identity data, then admits a safe rerun", async () => {
  const h = await freshMigrationDb();
  try {
    const entries = await journalEntries(canonicalFolder);
    const connectionEntry = entries.find((entry) => entry.tag.endsWith("_integration_connections"));
    if (connectionEntry === undefined)
      throw new TypeError("missing canonical connection migration");
    await installPrefix(h, connectionEntry.idx);
    expect(
      (await h.pool.query("SELECT to_regclass('public.integration_connections') AS name")).rows,
    ).toEqual([{ name: null }]);
    const owner = await seedOwner(h);
    await assertWorkflowConstraints(h, owner);
    const beforeLedger = await ledger(h);
    const beforeBusiness = await businessSnapshot(h);
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect((await ledger(h)).slice(0, beforeLedger.length)).toEqual(beforeLedger);
    expect(await ledger(h)).toHaveLength(entries.length);
    expect(await businessSnapshot(h)).toEqual(beforeBusiness);
    expect(
      (await h.pool.query("SELECT to_regclass('public.integration_connections')::text AS name"))
        .rows,
    ).toEqual([{ name: "integration_connections" }]);
    const connection = randomUUID();
    // Synthetic opaque bytes, never a usable provider credential or encryption key.
    const credentials = Buffer.from("00ff81696e746567726174696f6e", "hex");
    const settings = { channelId: "CLOCALTEST", channelName: "آزمون محلی" };
    await h.pool.query(
      "INSERT INTO integration_connections (id,provider,account_id,account_name,owner_id,credentials,scopes,settings) VALUES ($1,'slack','TLOCALTEST','Local workspace',$2,$3,$4,$5)",
      [connection, owner, credentials, JSON.stringify(["chat:write", "channels:read"]), settings],
    );
    await h.pool.query(
      "INSERT INTO integration_events (connection_id,actor_id,action) VALUES ($1,$2,'connected')",
      [connection, owner],
    );
    const connections = (await h.pool.query("SELECT * FROM integration_connections ORDER BY id"))
      .rows;
    const events = (await h.pool.query("SELECT * FROM integration_events ORDER BY id")).rows;
    const completedLedger = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect(await ledger(h)).toEqual(completedLedger);
    expect(await businessSnapshot(h)).toEqual(beforeBusiness);
    expect((await h.pool.query("SELECT * FROM integration_connections ORDER BY id")).rows).toEqual(
      connections,
    );
    expect((await h.pool.query("SELECT * FROM integration_events ORDER BY id")).rows).toEqual(
      events,
    );
  } finally {
    await h.close();
  }
});

test("guarded migration rejects the real original CONN83 and WF84 platform history", async () => {
  const h = await freshMigrationDb();
  try {
    await installOriginalPlatformHistory(h);
    const before = await ledger(h);
    expect(await applyMigrations(h.db)).toEqual({
      ok: false,
      error: "unsupported migration history: expected an exact canonical prefix",
    });
    expect(await ledger(h)).toEqual(before);
    expect(
      (
        await h.pool.query(
          "SELECT to_regclass('public.integration_connections')::text AS connections, to_regclass('public.workflow_versions')::text AS versions, to_regclass('public.privacy_cases') AS privacy",
        )
      ).rows,
    ).toEqual([
      { connections: "integration_connections", versions: "workflow_versions", privacy: null },
    ]);
  } finally {
    await h.close();
  }
});
