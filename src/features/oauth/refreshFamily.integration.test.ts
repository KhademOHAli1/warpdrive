import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { oauthClients } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createMcpResourceFixtures,
  type McpResourceFixtures,
  mcpResource,
} from "@/test/mcpResourceFixtures";
import { exchangeMcpGrant } from "./exchange";
import { sha256Base64Url } from "./pkce";

let h: TestDb | undefined;
let fixture: McpResourceFixtures | undefined;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
  fixture = await createMcpResourceFixtures(h);
});
afterEach(async () => {
  try {
    await fixture?.close();
  } finally {
    await h?.close();
    fixture = undefined;
    h = undefined;
  }
});

function refresh(
  f: McpResourceFixtures,
  token: string,
  abortSignal: AbortSignal,
  clientId = f.clientId,
) {
  return exchangeMcpGrant(
    f.ownerDb,
    { ...f.refreshGrant(mcpResource()), refresh_token: token, client_id: clientId },
    abortSignal,
  );
}

async function createChains(f: McpResourceFixtures, abortSignal: AbortSignal) {
  const first = await refresh(f, f.refreshToken, abortSignal);
  abortSignal.throwIfAborted();
  expect(first.ok).toBe(true);
  assert(first.ok);
  const second = await refresh(f, first.value.refresh_token, abortSignal);
  abortSignal.throwIfAborted();
  expect(second.ok).toBe(true);
  assert(second.ok);
  const independent = await exchangeMcpGrant(f.ownerDb, f.codeGrant(mcpResource()), abortSignal);
  abortSignal.throwIfAborted();
  expect(independent.ok).toBe(true);
  assert(independent.ok);
  return {
    root: f.refreshToken,
    intermediate: first.value.refresh_token,
    descendant: second.value.refresh_token,
    independent: independent.value.refresh_token,
  };
}

type Snapshot = Awaited<ReturnType<McpResourceFixtures["snapshot"]>>;
function credentialKeys(snapshot: Snapshot) {
  return {
    codes: snapshot.codes.map((row) => row.codeHash),
    access: snapshot.access.map((row) => row.jti),
    refresh: snapshot.refresh.map((row) => row.tokenHash),
  };
}

test.each(["root", "intermediate"] as const)(
  "replaying the %s refresh token contains its active descendant and preserves an independent grant",
  async (replayed) => {
    assert(fixture !== undefined);
    const f = fixture;
    const chain = await createChains(f, signal());
    const before = await f.snapshot();
    const rootHash = sha256Base64Url(chain.root);
    const intermediateHash = sha256Base64Url(chain.intermediate);
    const descendantHash = sha256Base64Url(chain.descendant);
    const independentHash = sha256Base64Url(chain.independent);
    expect(before.refresh.find((row) => row.tokenHash === rootHash)?.rotatedTo).toBe(
      intermediateHash,
    );
    expect(before.refresh.find((row) => row.tokenHash === intermediateHash)?.rotatedTo).toBe(
      descendantHash,
    );
    expect(before.refresh.find((row) => row.tokenHash === descendantHash)?.revokedAt).toBeNull();
    const independentBefore = before.refresh.find((row) => row.tokenHash === independentHash);
    assert(independentBefore !== undefined);
    expect(independentBefore).toMatchObject({
      clientId: f.clientId,
      userId: f.userId,
      revokedAt: null,
    });

    expect(await refresh(f, chain[replayed], signal())).toEqual({
      ok: false,
      error: "invalid_grant",
    });
    const afterReplay = await f.snapshot();
    expect(credentialKeys(afterReplay)).toEqual(credentialKeys(before));
    expect
      .soft(
        afterReplay.refresh.find((row) => row.tokenHash === descendantHash)?.revokedAt,
        "replay must revoke the active R2 descendant before another refresh can use it",
      )
      .toBeInstanceOf(Date);
    expect
      .soft(afterReplay.refresh.find((row) => row.tokenHash === independentHash))
      .toEqual(independentBefore);
    expect.soft(await refresh(f, chain.descendant, signal())).toEqual({
      ok: false,
      error: "invalid_grant",
    });
    expect.soft(credentialKeys(await f.snapshot())).toEqual(credentialKeys(afterReplay));

    const independent = await refresh(f, chain.independent, signal());
    expect(independent.ok).toBe(true);
    assert(independent.ok);
    expect(independent.value.refresh_token).not.toBe(chain.independent);
  },
);

test.each(["unknown token", "wrong client"] as const)(
  "%s cannot mutate or revoke the valid refresh families",
  async (invalid) => {
    assert(fixture !== undefined);
    const f = fixture;
    const chain = await createChains(f, signal());
    let clientId = f.clientId;
    if (invalid === "wrong client") {
      clientId = randomUUID();
      await f.ownerDb.insert(oauthClients).values({
        id: clientId,
        name: "Unrelated refresh client",
        redirectUris: [],
      });
    }
    const before = await f.snapshot();
    const token = invalid === "unknown token" ? randomBytes(32).toString("base64url") : chain.root;
    expect(await refresh(f, token, signal(), clientId)).toEqual({
      ok: false,
      error: "invalid_grant",
    });
    expect(await f.snapshot()).toEqual(before);

    const descendant = await refresh(f, chain.descendant, signal());
    expect(descendant.ok).toBe(true);
    assert(descendant.ok);
    expect(descendant.value.refresh_token).not.toBe(chain.descendant);
    const independent = await refresh(f, chain.independent, signal());
    expect(independent.ok).toBe(true);
    assert(independent.ok);
    expect(independent.value.refresh_token).not.toBe(chain.independent);
  },
);
