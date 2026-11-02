import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createMcpResourceFixtures,
  type McpResourceFixtures,
  mcpResource,
} from "@/test/mcpResourceFixtures";
import { exchangeMcpGrant } from "./exchange";
import { sha256Base64Url } from "./pkce";
import { issueRefreshToken } from "./tokens";

let h: TestDb | undefined;
let fixture: McpResourceFixtures | undefined;
let boundedPool: Pool | undefined;
let boundedDb: Db | undefined;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
  fixture = await createMcpResourceFixtures(h);
  boundedPool = new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 1_000,
    statement_timeout: 5_000,
  });
  boundedDb = drizzle(boundedPool, { schema });
});
afterEach(async () => {
  const outcomes = await Promise.allSettled([boundedPool?.end(), fixture?.close()]);
  outcomes.push(...(await Promise.allSettled([h?.close()])));
  boundedDb = undefined;
  boundedPool = undefined;
  fixture = undefined;
  h = undefined;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") throw outcome.reason;
  }
});

interface Owner {
  clientId: string;
  userId: string;
}

function refresh(
  db: Db,
  f: McpResourceFixtures,
  token: string,
  clientId: string,
  abortSignal: AbortSignal,
) {
  return exchangeMcpGrant(
    db,
    { ...f.refreshGrant(mcpResource()), refresh_token: token, client_id: clientId },
    abortSignal,
  );
}

async function chain(f: McpResourceFixtures, abortSignal: AbortSignal) {
  const first = await refresh(f.ownerDb, f, f.refreshToken, f.clientId, abortSignal);
  abortSignal.throwIfAborted();
  expect(first.ok).toBe(true);
  assert(first.ok);
  const second = await refresh(f.ownerDb, f, first.value.refresh_token, f.clientId, abortSignal);
  abortSignal.throwIfAborted();
  expect(second.ok).toBe(true);
  assert(second.ok);
  const independent = await exchangeMcpGrant(f.ownerDb, f.codeGrant(mcpResource()), abortSignal);
  abortSignal.throwIfAborted();
  expect(independent.ok).toBe(true);
  assert(independent.ok);
  const before = await f.snapshot();
  abortSignal.throwIfAborted();
  const rootHash = sha256Base64Url(f.refreshToken);
  const intermediateHash = sha256Base64Url(first.value.refresh_token);
  const tipHash = sha256Base64Url(second.value.refresh_token);
  expect(before.refresh.find((row) => row.tokenHash === rootHash)?.rotatedTo).toBe(
    intermediateHash,
  );
  expect(before.refresh.find((row) => row.tokenHash === intermediateHash)?.rotatedTo).toBe(tipHash);
  expect(before.refresh.find((row) => row.tokenHash === tipHash)).toMatchObject({
    clientId: f.clientId,
    userId: f.userId,
    revokedAt: null,
    rotatedTo: null,
  });
  return {
    root: f.refreshToken,
    intermediateHash,
    tip: second.value.refresh_token,
    independent: independent.value.refresh_token,
  };
}

async function expectUsable(
  f: McpResourceFixtures,
  token: string,
  owner: Owner,
  abortSignal: AbortSignal,
) {
  const result = await refresh(f.ownerDb, f, token, owner.clientId, abortSignal);
  abortSignal.throwIfAborted();
  expect(result.ok).toBe(true);
  assert(result.ok);
  expect(result.value.refresh_token).not.toBe(token);
  const after = await f.snapshot();
  abortSignal.throwIfAborted();
  expect(
    after.refresh.find((row) => row.tokenHash === sha256Base64Url(result.value.refresh_token)),
  ).toMatchObject({
    clientId: owner.clientId,
    userId: owner.userId,
    revokedAt: null,
    rotatedTo: null,
  });
}

const corruptions = ["missing row", "ancestor cycle", "other client", "other user"] as const;
test.each(corruptions)(
  "%s rotation link rejects replay without partial containment or a broad revocation sweep",
  async (corruption) => {
    assert(h !== undefined && fixture !== undefined && boundedDb !== undefined);
    const testDb = h;
    const f = fixture;
    const tokens = await chain(f, signal());
    const owner = { userId: f.userId, clientId: f.clientId };
    let targetHash = sha256Base64Url(randomBytes(32).toString("base64url"));
    let foreign: (Owner & { token: string }) | undefined;
    if (corruption === "ancestor cycle") {
      targetHash = sha256Base64Url(tokens.root);
    } else if (corruption === "other client" || corruption === "other user") {
      let clientId = f.clientId;
      let userId = f.userId;
      if (corruption === "other client") {
        clientId = randomUUID();
        await f.ownerDb.insert(schema.oauthClients).values({
          id: clientId,
          name: "Foreign integrity client",
          redirectUris: [f.redirectUri],
        });
      } else {
        userId = (await seedUser(f.ownerDb)).id;
      }
      const token = await issueRefreshToken(f.ownerDb, { clientId, userId }, signal());
      foreign = { token, clientId, userId };
      targetHash = sha256Base64Url(token);
    }
    // Corrupt the middle link after a genuine R0 -> R1 -> R2 history has been observed.
    const changed = await testDb.pool.query(
      "UPDATE oauth_refresh_tokens SET rotated_to = $1 WHERE token_hash = $2",
      [targetHash, tokens.intermediateHash],
    );
    expect(changed.rowCount).toBe(1);
    const before = await f.snapshot();
    if (corruption === "missing row") {
      expect(before.refresh.some((row) => row.tokenHash === targetHash)).toBe(false);
    }
    if (foreign !== undefined) {
      expect(before.refresh.find((row) => row.tokenHash === targetHash)).toMatchObject({
        userId: foreign.userId,
        clientId: foreign.clientId,
        revokedAt: null,
        rotatedTo: null,
      });
    }
    expect(await refresh(boundedDb, f, tokens.root, f.clientId, signal())).toEqual({
      ok: false,
      error: "invalid_grant",
    });
    // Complete ordered snapshots include IDs, timestamps and links in all three stores.
    expect(await f.snapshot()).toEqual(before);
    await expectUsable(f, tokens.tip, owner, signal());
    await expectUsable(f, tokens.independent, owner, signal());
    if (foreign !== undefined) await expectUsable(f, foreign.token, foreign, signal());
  },
);
