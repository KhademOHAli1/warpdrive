import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { buildAppContext, buildContactActor } from "@/features/mcp/actorContext";
import { registerWriteTools } from "@/features/mcp/tools/writes";
import { hydrateActor } from "@/server/hydrateActor";
import { listPersonMatchCandidates } from "./personOptionsRepo";

it("recomputes phone identity for MCP writes and preserves exact Persian input in real storage", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const signal = AbortSignal.timeout(10_000);
    const actor = await hydrateActor(db, user.id, signal);
    if (actor === null) throw new Error("missing actor");
    const server = new McpServer({ name: "phone-data-conventions", version: "1" });
    const tools = registerWriteTools(server, () => buildAppContext(db, actor), db);
    const raw = " ۰۹۱۲ ۳۴۵ ۶۷۸۹ ";
    const result = await tools.invoke("create_person", {
      name: "مخاطب نمونه",
      phones: [{ label: "mobile", value: raw, country: "IR", e164: "+493023125000" }],
    });
    expect(result.isError).not.toBe(true);
    const [stored] = await db.select().from(persons).where(eq(persons.name, "مخاطب نمونه"));
    expect(stored?.phones).toEqual([
      {
        label: "mobile",
        value: raw,
        country: "IR",
        primary: false,
        normalization: "valid",
        e164: "+989123456789",
      },
    ]);
    const candidates = await listPersonMatchCandidates(
      db,
      await buildContactActor(db, actor, signal),
      signal,
    );
    expect(candidates.find((item) => item.id === stored?.id)?.phones).toEqual(["+989123456789"]);
  });
});

it("never exposes a normalized phone belonging to an invisible private contact in match candidates", async () => {
  await withTestDb(async (db) => {
    const owner = await seedUser(db);
    const viewer = await seedUser(db);
    await db.insert(persons).values({
      name: "Private owner",
      ownerId: owner.id,
      visibilityLevel: "owner",
      phones: [
        {
          label: "mobile",
          value: "۰۹۱۲۳۴۵۶۷۸۹",
          country: "IR",
          e164: "+989123456789",
          normalization: "valid",
          primary: true,
        },
      ],
    });
    const signal = AbortSignal.timeout(10_000);
    const actor = await hydrateActor(db, viewer.id, signal);
    if (actor === null) throw new Error("missing actor");
    expect(
      await listPersonMatchCandidates(db, await buildContactActor(db, actor, signal), signal),
    ).toEqual([]);
  });
});
