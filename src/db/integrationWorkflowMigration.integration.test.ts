import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, test } from "vitest";
import { z } from "zod";
import { makeTestDb, type TestDb } from "@/test/db";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const journalInput = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z.object({
      idx: z.number(),
      version: z.string(),
      when: z.number(),
      tag: z.string(),
      breakpoints: z.boolean(),
    }),
  ),
});

async function rebuild(h: TestDb, migrationsFolder: string): Promise<void> {
  // The reset is restricted to a disposable harness database, never the local preview.
  expect(new URL(h.url).pathname).toMatch(/^\/t_[a-f0-9]+$/);
  await h.pool.query(
    "DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public",
  );
  await migrate(h.db, { migrationsFolder });
}

async function seedOwner(h: TestDb): Promise<string> {
  const owner = randomUUID();
  await h.pool.query(
    "INSERT INTO users (id,email,name,is_admin) VALUES ($1,'migration-owner@example.com','علی آزمون',true)",
    [owner],
  );
  return owner;
}

async function assertWorkflowConstraints(h: TestDb, owner: string): Promise<void> {
  expect(
    (
      await h.pool.query(
        "SELECT to_regclass('public.workflows')::text AS workflows, to_regclass('public.workflow_versions')::text AS versions, to_regclass('public.workflow_runs')::text AS runs, to_regclass('public.workflow_steps')::text AS steps",
      )
    ).rows,
  ).toEqual([
    {
      workflows: "workflows",
      versions: "workflow_versions",
      runs: "workflow_runs",
      steps: "workflow_steps",
    },
  ]);
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

test("clean migrations install integrations and workflows with database-enforced version safety", async () => {
  const h = await makeTestDb();
  try {
    await rebuild(h, folder);
    expect(
      (await h.pool.query("SELECT to_regclass('public.integration_connections')::text AS name"))
        .rows,
    ).toEqual([{ name: "integration_connections" }]);
    await assertWorkflowConstraints(h, await seedOwner(h));
  } finally {
    await h.close();
  }
});

test("workflow upgrade preserves existing connections, credentials, settings and independent locale preferences", async () => {
  const baseline = mkdtempSync(join(tmpdir(), "warpdrive-integration-workflow-migration-"));
  const h = await makeTestDb();
  try {
    const journal = journalInput.parse(
      JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8")),
    );
    const entries = journal.entries.filter((entry) => entry.idx <= 83);
    expect(entries.at(-1)?.tag).toBe("0083_integration_connections");
    mkdirSync(join(baseline, "meta"));
    writeFileSync(join(baseline, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      copyFileSync(join(folder, `${entry.tag}.sql`), join(baseline, `${entry.tag}.sql`));
    await rebuild(h, baseline);
    const owner = await seedOwner(h);
    const connection = randomUUID();
    // Synthetic opaque bytes only, not a usable provider credential or encryption key.
    const credentials = Buffer.from("synthetic-encrypted-credential-fixture");
    const settings = { channelId: "CLOCALTEST", channelName: "آزمون محلی" };
    const preferences = {
      localePreferences: {
        locale: "fa",
        calendar: "gregory",
        numberingSystem: "latn",
        timeZone: "Europe/Berlin",
      },
    };
    await h.pool.query(
      "INSERT INTO integration_connections (id,provider,account_id,account_name,owner_id,credentials,scopes,settings) VALUES ($1,'slack','TLOCALTEST','Local workspace',$2,$3,$4,$5)",
      [connection, owner, credentials, JSON.stringify(["chat:write", "channels:read"]), settings],
    );
    await h.pool.query(
      "INSERT INTO integration_events (connection_id,actor_id,action) VALUES ($1,$2,'connected')",
      [connection, owner],
    );
    await h.pool.query("INSERT INTO user_preferences (user_id,ui) VALUES ($1,$2)", [
      owner,
      preferences,
    ]);
    const beforeConnections = (await h.pool.query("SELECT * FROM integration_connections")).rows;
    const beforeEvents = (await h.pool.query("SELECT * FROM integration_events")).rows;
    const beforeUsers = (await h.pool.query("SELECT * FROM users")).rows;
    const beforePreferences = (await h.pool.query("SELECT * FROM user_preferences")).rows;
    await migrate(h.db, { migrationsFolder: folder });
    expect((await h.pool.query("SELECT * FROM integration_connections")).rows).toEqual(
      beforeConnections,
    );
    expect((await h.pool.query("SELECT * FROM integration_events")).rows).toEqual(beforeEvents);
    expect((await h.pool.query("SELECT * FROM users")).rows).toEqual(beforeUsers);
    expect((await h.pool.query("SELECT * FROM user_preferences")).rows).toEqual(beforePreferences);
    await assertWorkflowConstraints(h, owner);
  } finally {
    await h.close();
    rmSync(baseline, { recursive: true, force: true });
  }
});
