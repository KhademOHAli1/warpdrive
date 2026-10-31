import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { deals, leads, permissionSets } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { buildAppContext } from "@/features/mcp/actorContext";
import { hydrateActor } from "@/server/hydrateActor";
import { registerWriteTools } from "./writes";

async function creatorTools(db: Parameters<typeof seedUser>[0]) {
  const [set] = await db
    .insert(permissionSets)
    .values({
      name: `ps-${Math.random().toString(36).slice(2)}`,
      flags: {
        "deal.create": true,
        "deal.changeOwner_any": true,
      },
    })
    .returning();
  const creator = await seedUser(db, { permissionSetId: set?.id });
  const target = await seedUser(db);
  const actor = await hydrateActor(db, creator.id, AbortSignal.timeout(5_000));
  if (actor === null) throw new Error("hydrate failed");
  const server = new McpServer({ name: "write-tools-test", version: "1.0.0" });
  const tools = registerWriteTools(server, () => buildAppContext(db, actor), db);
  return { tools, creator, target };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("");
}

test("create_deal assigned to an unmanaged user returns success without the record", async () => {
  await withTestDb(async (db) => {
    const { tools, target } = await creatorTools(db);
    const seeded = await seedPipelineWithStages(db, ["Open"]);
    const result = await tools.invoke("create_deal", {
      title: "Handed away deal",
      pipelineId: seeded.pipeline.id,
      stageId: seeded.stages[0]!.id,
      ownerId: target.id,
    });
    expect(result.isError).not.toBe(true);
    const [row] = await db.select().from(deals).where(eq(deals.title, "Handed away deal"));
    expect(row?.ownerId).toBe(target.id);
    expect(text(result)).not.toContain(row?.id ?? "missing");
    expect(text(result)).not.toContain("Handed away deal");
  });
});

test("create_deal keeping ownership still returns the record", async () => {
  await withTestDb(async (db) => {
    const { tools } = await creatorTools(db);
    const seeded = await seedPipelineWithStages(db, ["Open"]);
    const result = await tools.invoke("create_deal", {
      title: "Own deal",
      pipelineId: seeded.pipeline.id,
      stageId: seeded.stages[0]!.id,
    });
    const [row] = await db.select().from(deals).where(eq(deals.title, "Own deal"));
    expect(text(result)).toContain(row?.id ?? "missing");
  });
});

test("create_lead assigned to an unmanaged user returns success without the record", async () => {
  await withTestDb(async (db) => {
    const { tools, target } = await creatorTools(db);
    const result = await tools.invoke("create_lead", {
      title: "Handed away lead",
      ownerId: target.id,
    });
    expect(result.isError).not.toBe(true);
    const [row] = await db.select().from(leads).where(eq(leads.title, "Handed away lead"));
    expect(row?.ownerId).toBe(target.id);
    expect(text(result)).not.toContain(row?.id ?? "missing");
    expect(text(result)).not.toContain("Handed away lead");
  });
});

test("create_lead keeping ownership still returns the record", async () => {
  await withTestDb(async (db) => {
    const { tools } = await creatorTools(db);
    const result = await tools.invoke("create_lead", { title: "Own lead" });
    const [row] = await db.select().from(leads).where(eq(leads.title, "Own lead"));
    expect(text(result)).toContain(row?.id ?? "missing");
  });
});
