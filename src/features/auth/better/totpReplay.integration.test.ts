import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { authTwoFactors, authUsers, users } from "@/db/schema";
import { authTotpReplays } from "@/db/schema/authTotpReplay";
import { makeTestDb, type TestDb } from "@/test/db";
import { claimTotpCode, pruneTotpReplays, TOTP_REPLAY_TTL_MS } from "./totpReplay";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function factor() {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await h.db.insert(users).values({ id, email, name: "TOTP replay" });
  await h.db.insert(authUsers).values({ id, email, name: "TOTP replay", emailVerified: true });
  const [row] = await h.db
    .insert(authTwoFactors)
    .values({ userId: id, secret: "fixture-secret", backupCodes: "[]" })
    .returning();
  if (row === undefined) throw new Error("missing factor");
  return row.id;
}

describe("atomic successful TOTP one-use reservations", () => {
  test("one concurrent request wins across replicas; only keyed digests are persisted", async () => {
    const factorId = await factor();
    const input = { factorId, code: "123456", secret: "replay-key-over-thirty-two-characters" };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => claimTotpCode(h.db, input, AbortSignal.timeout(5000))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimTotpCode(h.db, { ...input, code: "۱۲۳۴۵۶" }, AbortSignal.timeout(5000))).toBe(
      false,
    );
    const rows = await h.db.select().from(authTotpReplays);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(input.code);
    expect(JSON.stringify(rows)).not.toContain(input.secret);
  });

  test("expires reservations, isolates factors, prunes old rows and aborts before writes", async () => {
    const input = {
      factorId: await factor(),
      code: "234567",
      secret: "replay-key-over-thirty-two-characters",
    };
    expect(await claimTotpCode(h.db, input, AbortSignal.timeout(5000))).toBe(true);
    expect(
      await claimTotpCode(h.db, { ...input, factorId: await factor() }, AbortSignal.timeout(5000)),
    ).toBe(true);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + TOTP_REPLAY_TTL_MS + 1);
    try {
      expect(await claimTotpCode(h.db, input, AbortSignal.timeout(5000))).toBe(true);
      await pruneTotpReplays(h.db, AbortSignal.timeout(5000));
      expect(await h.db.select().from(authTotpReplays)).toHaveLength(1);
      await expect(
        claimTotpCode(h.db, { ...input, code: "345678" }, AbortSignal.abort()),
      ).rejects.toThrow();
      expect(await h.db.select().from(authTotpReplays)).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });
});
