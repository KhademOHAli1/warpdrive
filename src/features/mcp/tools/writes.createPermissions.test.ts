import { McpServer } from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { activities, activityTypes, organizations, permissionSets, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { buildAppContext } from "@/features/mcp/actorContext";
import { hydrateActor } from "@/server/hydrateActor";
import { registerWriteTools } from "./writes";

describe("MCP create capability boundary", () => {
  it("denies all three create tools for an authenticated read-only user", async () => {
    await withTestDb(async (db) => {
      const [set] = await db
        .insert(permissionSets)
        .values({ name: "mcp-read-only", flags: {} })
        .returning();
      const user = await seedUser(db, { permissionSetId: set?.id });
      const actor = await hydrateActor(db, user.id, AbortSignal.timeout(5_000));
      if (actor === null) throw new Error("actor missing");
      const server = new McpServer({ name: "create-permissions-test", version: "1.0.0" });
      const tools = registerWriteTools(server, () => buildAppContext(db, actor), db);
      const [type] = await db.select().from(activityTypes).where(eq(activityTypes.key, "call"));
      if (type === undefined) throw new Error("activity type missing");

      for (const [name, input] of [
        ["create_person", { name: "Denied Person" }],
        ["create_organization", { name: "Denied Organization" }],
        ["create_activity", { typeId: type.id, subject: "Denied Activity" }],
      ] as const) {
        const result = await tools.invoke(name, input);
        expect(result.isError).toBe(true);
        expect(result.content[0]).toMatchObject({
          type: "text",
          text: expect.stringContaining(ERROR_IDS.PERM_DENIED),
        });
      }
      expect(await db.select().from(persons).where(eq(persons.name, "Denied Person"))).toHaveLength(
        0,
      );
      expect(
        await db.select().from(organizations).where(eq(organizations.name, "Denied Organization")),
      ).toHaveLength(0);
      expect(
        await db.select().from(activities).where(eq(activities.subject, "Denied Activity")),
      ).toHaveLength(0);
    });
  });

  it("allows contact creation when the contact.create flag is present", async () => {
    await withTestDb(async (db) => {
      const [set] = await db
        .insert(permissionSets)
        .values({ name: "mcp-contact-creator", flags: { "contact.create": true } })
        .returning();
      const user = await seedUser(db, { permissionSetId: set?.id });
      const actor = await hydrateActor(db, user.id, AbortSignal.timeout(5_000));
      if (actor === null) throw new Error("actor missing");
      const server = new McpServer({ name: "create-permissions-test", version: "1.0.0" });
      const tools = registerWriteTools(server, () => buildAppContext(db, actor), db);
      expect((await tools.invoke("create_person", { name: "Allowed Person" })).isError).not.toBe(
        true,
      );
      expect(
        (await tools.invoke("create_organization", { name: "Allowed Organization" })).isError,
      ).not.toBe(true);
      expect(
        await db.select().from(persons).where(eq(persons.name, "Allowed Person")),
      ).toHaveLength(1);
      expect(
        await db.select().from(organizations).where(eq(organizations.name, "Allowed Organization")),
      ).toHaveLength(1);
    });
  });
});
