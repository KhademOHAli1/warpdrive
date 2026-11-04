import { afterAll, beforeAll, expect, it } from "vitest";
import { seedUser } from "@/db/testing/factories";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeCaller } from "@/server/testCaller";
import { makeTestDb } from "@/test/db";
import { readPackageVersion } from "./currentVersion";
import { readReleaseStatus, upsertReleaseStatus } from "./releaseStatus";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(async () => {
  await ctx.close();
});

function makeActor(id: string): PermSetUser {
  return {
    id,
    type: "admin",
    isActive: true,
    groupIds: new Set<string>(),
    flags: new Set(),
  };
}

it("returns the current version with no update when nothing is cached", async () => {
  const user = await seedUser(ctx.db);
  const caller = makeCaller(ctx.db, makeActor(user.id));
  const s = await caller.version.get();
  expect(s.current).toBe(readPackageVersion());
  expect(s.latest).toBeNull();
  expect(s.updateAvailable).toBeNull();
  expect(s.disabled).toBe(false);
});

it("reports an update available when a newer release is cached", async () => {
  const user = await seedUser(ctx.db);
  await upsertReleaseStatus(ctx.db, {
    latestTag: "v999.0.0",
    releaseUrl: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v999.0.0",
    releaseNotes: "big news",
  });
  const caller = makeCaller(ctx.db, makeActor(user.id));
  const s = await caller.version.get();
  expect(s.latest).toBe("v999.0.0");
  expect(s.releaseNotes).toBe("big news");
  expect(s.updateAvailable).toBe(true);
});

it.each([
  ["upstream", "https://github.com/sneg55/warpdrive/releases/tag/v999.0.0"],
  ["unknown", null],
])(
  "does not surface a cached release with %s provenance or delete its row",
  async (_, releaseUrl) => {
    const user = await seedUser(ctx.db);
    await upsertReleaseStatus(ctx.db, {
      latestTag: "v999.0.0",
      releaseUrl,
      releaseNotes: "untrusted cache contents",
    });
    const before = await readReleaseStatus(ctx.db);
    const caller = makeCaller(ctx.db, makeActor(user.id));
    expect(await caller.version.get()).toEqual({
      current: readPackageVersion(),
      latest: null,
      releaseUrl: null,
      releaseNotes: null,
      updateAvailable: null,
      checkedAt: null,
      disabled: false,
    });
    expect(await readReleaseStatus(ctx.db)).toEqual(before);
  },
);
