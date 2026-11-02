import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import { expect, it, vi } from "vitest";
import { makeTestDb } from "@/test/db";
import { observeBossErrors } from "./bossObserver";

it("recovers native queue polling after only its fixture connections are terminated", async () => {
  const h = await makeTestDb();
  const applicationName = `boss-observer-${randomUUID()}`;
  const boss = new PgBoss({
    connectionString: h.url,
    application_name: applicationName,
    max: 1,
    schedule: false,
    supervise: false,
    useListenNotify: false,
  });
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  observeBossErrors(boss, "worker");
  const handled: string[] = [];
  try {
    await boss.start();
    await boss.createQueue("observer-recovery", { retryLimit: 0 });
    await boss.work("observer-recovery", { pollingIntervalSeconds: 0.5 }, (jobs) => {
      handled.push(...jobs.map((job) => job.id));
      return Promise.resolve();
    });
    const killed = await h.pool.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated
       FROM pg_stat_activity
       WHERE datname = current_database() AND application_name = $1 AND pid <> pg_backend_pid()`,
      [applicationName],
    );
    expect(killed.rows.some((row) => row.terminated)).toBe(true);
    await vi.waitFor(() => expect(report).toHaveBeenCalled(), { timeout: 10_000 });
    // The killed pool connection can reject a readiness query before native
    // polling replaces it. Retry only this read; submit the job exactly once.
    await vi.waitFor(
      async () =>
        expect((await boss.getQueue("observer-recovery"))?.name).toBe("observer-recovery"),
      { timeout: 10_000 },
    );

    const id = await boss.send("observer-recovery", {
      value: "پس از اتصال دوباره · Wieder verbunden",
    });
    expect(id).not.toBeNull();
    await vi.waitFor(
      async () => {
        const job = await boss.getJobById("observer-recovery", id ?? "");
        expect(job?.state).toBe("completed");
        expect(job?.retryCount).toBe(0);
      },
      { timeout: 10_000 },
    );
    expect(handled).toEqual([id]);
    expect(
      report.mock.calls.every(
        (call) =>
          JSON.stringify(call) ===
          JSON.stringify([
            "pg-boss background error",
            { code: "queue_background_error", source: "worker" },
          ]),
      ),
    ).toBe(true);
  } finally {
    await boss.stop({ graceful: false, timeout: 1_000 });
    report.mockRestore();
    await h.close();
  }
});

it("leaves handler failure and the configured native retry policy intact", async () => {
  const h = await makeTestDb();
  const boss = new PgBoss({ connectionString: h.url, max: 2, schedule: false, supervise: false });
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  observeBossErrors(boss, "worker");
  const handled: string[] = [];
  try {
    await boss.start();
    await boss.createQueue("observer-handler", {
      retryLimit: 1,
      retryDelay: 1,
      retryBackoff: true,
    });
    await boss.work("observer-handler", { pollingIntervalSeconds: 0.5 }, (jobs) => {
      handled.push(...jobs.map((job) => job.id));
      if (handled.length === 1)
        return Promise.reject(new Error("synthetic business-handler failure"));
      return Promise.resolve();
    });
    const id = await boss.send("observer-handler", { fixture: true });
    expect(id).not.toBeNull();
    await vi.waitFor(
      async () => {
        const job = await boss.getJobById("observer-handler", id ?? "");
        expect(job?.state).toBe("completed");
        expect(job?.retryCount).toBe(1);
      },
      { timeout: 10_000 },
    );
    expect(handled).toEqual([id, id]);
  } finally {
    await boss.stop({ graceful: false, timeout: 1_000 });
    report.mockRestore();
    await h.close();
  }
});
