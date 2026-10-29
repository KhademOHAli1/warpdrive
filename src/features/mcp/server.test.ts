import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { deals } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { buildAppContext } from "@/features/mcp/actorContext";
import { hydrateActor } from "@/server/hydrateActor";
import { buildMcpServer, listToolNames } from "./server";

const EXPECTED_TOOLS = [
  "search",
  "list_deals",
  "get_deal",
  "list_leads",
  "get_lead",
  "list_persons",
  "get_person",
  "list_organizations",
  "get_organization",
  "list_activities",
  "get_activity",
  "list_pipelines",
  "get_pipeline",
  "pipeline_summary",
  "create_deal",
  "update_deal",
  "move_deal_stage",
  "create_lead",
  "update_lead",
  "convert_lead_to_deal",
  "archive_lead",
  "create_person",
  "update_person",
  "create_organization",
  "update_organization",
  "create_activity",
  "update_activity",
  "complete_activity",
  "add_note",
  "list_emails",
  "get_email",
  "list_email_drafts",
  "create_email_draft",
  "update_email_draft",
  "delete_email_draft",
] as const;

test("MCP server exposes the complete tool set without destructive tools", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor = await hydrateActor(db, user.id, AbortSignal.timeout(5_000));
    expect(actor).not.toBeNull();
    if (actor === null) return;

    const server = buildMcpServer(() => buildAppContext(db, actor), db);
    const names = listToolNames(server);

    expect(names).toEqual(expect.arrayContaining([...EXPECTED_TOOLS]));
    expect(names).toHaveLength(EXPECTED_TOOLS.length);
    // No destructive tool on a CRM record. Unsent email drafts are the one exception: they are the
    // actor's own owner-scoped text, not a record anyone else can see.
    const records = names.filter((name) => !name.endsWith("_email_draft"));
    expect(records.some((name) => /delete|remove|destroy/i.test(name))).toBe(false);
  });
});

test("tools/list serves every registered tool over the wire (each input schema is JSON-Schema representable)", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor = await hydrateActor(db, user.id, AbortSignal.timeout(5_000));
    expect(actor).not.toBeNull();
    if (actor === null) return;

    const server = buildMcpServer(() => buildAppContext(db, actor), db);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    } finally {
      await client.close();
      await server.close();
    }
  });
});

test("wire calls validate input and retain write permissions", async () => {
  await withTestDb(async (db) => {
    const seeded = await seedPipelineWithStages(db, ["Open"]);
    const stage = seeded.stages[0];
    expect(stage).toBeDefined();
    if (stage === undefined) return;

    for (const isAdmin of [true, false]) {
      const user = await seedUser(db, { isAdmin });
      const actor = await hydrateActor(db, user.id, AbortSignal.timeout(5_000));
      expect(actor).not.toBeNull();
      if (actor === null) return;
      const server = buildMcpServer(() => buildAppContext(db, actor), db);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "wire-write-test", version: "0.0.0" });
      await client.connect(clientTransport);
      try {
        const title = isAdmin ? "Allowed wire deal" : "Denied wire deal";
        const input = { title, pipelineId: seeded.pipeline.id, stageId: stage.id };
        const invalid = await client.callTool({
          name: "create_deal",
          arguments: { ...input, title: "" },
        });
        expect(invalid.isError).toBe(true);
        expect(await db.select().from(deals).where(eq(deals.title, title))).toHaveLength(0);

        const result = await client.callTool({ name: "create_deal", arguments: input });
        expect(result.isError === true).toBe(!isAdmin);
        const rows = await db.select().from(deals).where(eq(deals.title, title));
        expect(rows).toHaveLength(isAdmin ? 1 : 0);
        if (!isAdmin) expect(JSON.stringify(result.content)).toContain(ERROR_IDS.PERM_DENIED);
      } finally {
        await client.close();
        await server.close();
      }
    }
  });
});
