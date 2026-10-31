import { eq } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";
import { expect, it } from "vitest";
import { env } from "@/config/env";
import { oauthAccessTokens, oauthClients } from "@/db/schema/oauth";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { hydrateActor } from "@/server/hydrateActor";
import { createCaller } from "@/server/trpc/root";
import { issueAccessToken, issueRefreshToken, verifyAccessToken } from "./tokens";

it("binds access tokens to the MCP resource and rejects a different audience", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(5000);
    const user = await seedUser(db);
    await db.insert(oauthClients).values({
      id: "audience-test",
      name: "Audience test",
      redirectUris: ["https://client.example/callback"],
    });
    const issued = await issueAccessToken(
      db,
      { userId: user.id, clientId: "audience-test" },
      signal,
    );
    const claims = decodeJwt(issued.token);
    expect(claims.aud).toBe(`${env.BASE_URL.replace(/\/$/, "")}/api/mcp`);
    const forged = await new SignJWT({ clientId: "audience-test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setJti(issued.jti)
      .setIssuer(env.BASE_URL)
      .setAudience("https://another.example/api/mcp")
      .setExpirationTime("5m")
      .sign(Buffer.from(env.OAUTH_SIGNING_KEY, "base64"));
    expect((await verifyAccessToken(db, forged, signal)).ok).toBe(false);
  });
});

it("keeps a connection visible while a valid refresh grant remains", async () => {
  await withTestDb(async (db) => {
    const signal = AbortSignal.timeout(5000);
    const user = await seedUser(db);
    await db.insert(oauthClients).values({
      id: "refresh-display",
      name: "Refresh display",
      redirectUris: ["https://client.example/callback"],
    });
    const owner = { userId: user.id, clientId: "refresh-display" };
    const issued = await issueAccessToken(db, owner, signal);
    await issueRefreshToken(db, owner, signal);
    await db
      .update(oauthAccessTokens)
      .set({ expiresAt: new Date(0) })
      .where(eq(oauthAccessTokens.jti, issued.jti));
    const actor = await hydrateActor(db, user.id, signal);
    if (actor === null) throw new Error("actor fixture missing");
    const connections = await createCaller({
      db,
      actor,
      session: { userId: user.id, sessionId: "synthetic-session" },
    }).oauth.listConnections();
    expect(connections.map((connection) => connection.clientId)).toContain("refresh-display");
  });
});
