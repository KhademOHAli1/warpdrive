import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { deals, oauthAccessTokens, oauthClients } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { issueAccessToken } from "@/features/oauth/tokens";
import { createAuthenticatedMcpHandler } from "./http";

const BASE_URL = env.BASE_URL;
const RESOURCE_BASE = BASE_URL.replace(/\/$/, "");
const ENDPOINT = new URL(`${RESOURCE_BASE}/api/mcp`);

test("HTTP authentication challenges unauthenticated requests with the configured resource", async () => {
  await withTestDb(async (db) => {
    const handler = createAuthenticatedMcpHandler(db, BASE_URL);
    for (const authorization of [undefined, "Bearer invalid"]) {
      const response = await handler(
        new Request(ENDPOINT, {
          method: "POST",
          headers: authorization === undefined ? {} : { authorization },
        }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        `resource_metadata="${RESOURCE_BASE}/.well-known/oauth-protected-resource"`,
      );
    }
  });
});

test.each(["legacy", "2026-07-28"] as const)(
  "%s HTTP clients retain tools, actor isolation, write permissions and revocation",
  async (protocol) => {
    await withTestDb(async (db) => {
      const handler = createAuthenticatedMcpHandler(db, BASE_URL);
      const seeded = await seedPipelineWithStages(db, ["Open"]);
      const stage = seeded.stages[0];
      expect(stage).toBeDefined();
      if (stage === undefined) return;
      const users = await Promise.all([seedUser(db), seedUser(db)]);
      await db.insert(oauthClients).values({
        id: "mcp-http-client",
        name: "MCP HTTP test",
        redirectUris: ["https://client.example.test/callback"],
      });
      const records = await db
        .insert(deals)
        .values(
          users.map((user, index) => ({
            title: `Private deal ${index}`,
            pipelineId: seeded.pipeline.id,
            stageId: stage.id,
            ownerId: user.id,
            visibilityLevel: "owner" as const,
          })),
        )
        .returning();
      const clients = await Promise.all(
        users.map(async (user) => {
          const token = await issueAccessToken(
            db,
            { clientId: "mcp-http-client", userId: user.id },
            AbortSignal.timeout(5_000),
          );
          const transport = new StreamableHTTPClientTransport(ENDPOINT, {
            requestInit: { headers: { authorization: `Bearer ${token.token}` } },
            fetch: async (url, init) => {
              const response = await handler(new Request(url, init));
              expect(response.headers.get("mcp-session-id")).toBeNull();
              return response;
            },
          });
          const client = new Client(
            { name: "http-test", version: "0.0.0" },
            {
              versionNegotiation: {
                mode: protocol === "legacy" ? "legacy" : { pin: protocol },
              },
            },
          );
          await client.connect(transport);
          return { client, token };
        }),
      );
      try {
        await Promise.all(
          clients.map(async ({ client }, index) => {
            const listed = await client.listTools();
            expect(listed.tools).toHaveLength(35);
            const own = records[index];
            const other = records[1 - index];
            expect(own).toBeDefined();
            expect(other).toBeDefined();
            if (own === undefined || other === undefined) return;
            const read = await client.callTool({ name: "get_deal", arguments: { id: own.id } });
            expect(read.isError).not.toBe(true);
            expect(JSON.stringify(read.content)).toContain(own.title);
            const hidden = await client.callTool({ name: "get_deal", arguments: { id: other.id } });
            expect(hidden.isError).toBe(true);
            expect(JSON.stringify(hidden.content)).toContain(ERROR_IDS.DEAL_NOT_FOUND);
            const denied = await client.callTool({
              name: "create_deal",
              arguments: {
                title: "Denied HTTP deal",
                pipelineId: seeded.pipeline.id,
                stageId: stage.id,
              },
            });
            expect(denied.isError).toBe(true);
            expect(JSON.stringify(denied.content)).toContain(ERROR_IDS.PERM_DENIED);
          }),
        );
        expect(
          await db.select().from(deals).where(eq(deals.title, "Denied HTTP deal")),
        ).toHaveLength(0);

        const first = clients[0];
        expect(first).toBeDefined();
        if (first === undefined) return;
        await db
          .update(oauthAccessTokens)
          .set({ revokedAt: new Date() })
          .where(eq(oauthAccessTokens.jti, first.token.jti));
        await expect(first.client.listTools()).rejects.toThrow();
      } finally {
        await Promise.all(clients.map(({ client }) => client.close()));
      }
    });
  },
);
