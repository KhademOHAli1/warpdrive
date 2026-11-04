import type { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PGBOSS_QUEUE_RELEASE_CHECK } from "@/constants/jobNames";
import { withTestDb } from "@/db/testing";
import { computeStatus } from "./computeStatus";
import { RELEASE_CHECK_CRON } from "./constants";
import { refreshReleaseCache, registerReleaseCheckJob } from "./job";
import { readReleaseStatus, upsertReleaseStatus } from "./releaseStatus";

const sig = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeBoss() {
  const queues: string[] = [];
  const schedules: { name: string; cron: string }[] = [];
  const sends: string[] = [];
  return {
    queues,
    schedules,
    sends,
    createQueue(name: string): Promise<void> {
      queues.push(name);
      return Promise.resolve();
    },
    work(name: string, handler: unknown): Promise<void> {
      void name;
      void handler;
      return Promise.resolve();
    },
    schedule(name: string, cron: string): Promise<void> {
      schedules.push({ name, cron });
      return Promise.resolve();
    },
    send(name: string): Promise<void> {
      sends.push(name);
      return Promise.resolve();
    },
  };
}

describe("refreshReleaseCache", () => {
  it("caches the latest release on a successful fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            tag_name: "v1.5.0",
            html_url: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.0",
            body: "notes",
          }),
        ),
      ),
    );
    await withTestDb(async (db) => {
      await refreshReleaseCache(db, sig());
      const row = await readReleaseStatus(db);
      expect(row?.latestTag).toBe("v1.5.0");
      expect(row?.releaseNotes).toBe("notes");
      expect(computeStatus("1.4.0", row, false).updateAvailable).toBe(true);
    });
  });

  it("leaves the last-good row intact when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("boom", { status: 500 }))),
    );
    await withTestDb(async (db) => {
      await upsertReleaseStatus(db, {
        latestTag: "v1.4.0",
        releaseUrl: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.4.0",
        releaseNotes: "last good distribution notes",
      });
      const before = await readReleaseStatus(db);
      await refreshReleaseCache(db, sig());
      const row = await readReleaseStatus(db);
      expect(row).toEqual(before);
      expect(computeStatus("1.3.0", row, false)).toMatchObject({
        latest: "v1.4.0",
        releaseNotes: "last good distribution notes",
        updateAvailable: true,
      });
    });
  });

  it.each([
    {
      label: "a foreign release URL",
      payload: {
        tag_name: "v1.5.2",
        html_url: "https://github.com/sneg55/warpdrive/releases/tag/v1.5.2",
        body: "foreign payload must not replace the distribution cache",
      },
    },
    {
      label: "no release URL",
      payload: { tag_name: "v1.5.2", body: "partial payload must not erase the last-good cache" },
    },
  ])(
    "preserves the valid distribution cache when a successful payload has $label",
    async ({ payload }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(Response.json(payload))),
      );
      await withTestDb(async (db) => {
        await upsertReleaseStatus(db, {
          latestTag: "v1.5.1",
          releaseUrl: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.1",
          releaseNotes: "last-good distribution notes",
        });
        const before = await readReleaseStatus(db);
        expect(before).not.toBeNull();
        await refreshReleaseCache(db, sig());
        const after = await readReleaseStatus(db);
        expect(after).toEqual(before);
        expect(computeStatus("1.5.0", after, false)).toMatchObject({
          latest: "v1.5.1",
          releaseUrl: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.1",
          releaseNotes: "last-good distribution notes",
          updateAvailable: true,
        });
      });
    },
  );

  it("keeps an upstream row stored but hidden before and after a failed fork refresh", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("no release", { status: 404 })));
    vi.stubGlobal("fetch", fetchSpy);
    await withTestDb(async (db) => {
      await upsertReleaseStatus(db, {
        latestTag: "v999.0.0",
        releaseUrl: "https://github.com/sneg55/warpdrive/releases/tag/v999.0.0",
        releaseNotes: "upstream notes",
      });
      const before = await readReleaseStatus(db);
      expect(computeStatus("1.5.1", before, false)).toMatchObject({
        latest: null,
        releaseUrl: null,
        releaseNotes: null,
        updateAvailable: null,
        checkedAt: null,
      });
      await refreshReleaseCache(db, sig());
      const after = await readReleaseStatus(db);
      expect(after).toEqual(before);
      expect(computeStatus("1.5.1", after, false)).toMatchObject({
        latest: null,
        releaseUrl: null,
        releaseNotes: null,
        updateAvailable: null,
        checkedAt: null,
      });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/KhademOHAli1/warpdrive/releases/latest",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("replaces the hidden upstream row with a visible distribution patch on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            tag_name: "v1.5.2",
            html_url: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
            body: "distribution patch notes",
          }),
        ),
      ),
    );
    await withTestDb(async (db) => {
      await upsertReleaseStatus(db, {
        latestTag: "v999.0.0",
        releaseUrl: "https://github.com/sneg55/warpdrive/releases/tag/v999.0.0",
        releaseNotes: "upstream notes",
      });
      expect(computeStatus("1.5.1", await readReleaseStatus(db), false).latest).toBeNull();
      await refreshReleaseCache(db, sig());
      const row = await readReleaseStatus(db);
      expect(row?.latestTag).toBe("v1.5.2");
      expect(computeStatus("1.5.1", row, false)).toMatchObject({
        latest: "v1.5.2",
        releaseUrl: "https://github.com/KhademOHAli1/warpdrive/releases/tag/v1.5.2",
        releaseNotes: "distribution patch notes",
        updateAvailable: true,
      });
    });
  });
});

describe("registerReleaseCheckJob", () => {
  it("creates the queue, schedules the cron, and kicks an immediate run when enabled", async () => {
    const boss = fakeBoss();
    await registerReleaseCheckJob(boss as unknown as PgBoss, false);
    expect(boss.queues).toContain(PGBOSS_QUEUE_RELEASE_CHECK);
    expect(boss.schedules).toContainEqual({
      name: PGBOSS_QUEUE_RELEASE_CHECK,
      cron: RELEASE_CHECK_CRON,
    });
    expect(boss.sends).toContain(PGBOSS_QUEUE_RELEASE_CHECK);
  });

  it("registers nothing when the update check is disabled", async () => {
    const boss = fakeBoss();
    await registerReleaseCheckJob(boss as unknown as PgBoss, true);
    expect(boss.queues).toHaveLength(0);
    expect(boss.schedules).toHaveLength(0);
    expect(boss.sends).toHaveLength(0);
  });
});
