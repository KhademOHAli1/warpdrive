import { EventEmitter } from "node:events";
import { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAppBoss } from "./appInstrumentation";

describe("startAppBoss", () => {
  afterEach(() => vi.restoreAllMocks());
  it("starts a boss and publishes it before returning", async () => {
    let didStart = false;
    const boss = Object.assign(new EventEmitter(), {
      start: vi.fn((): Promise<PgBoss> => {
        didStart = true;
        return Promise.resolve(boss);
      }),
    }) as unknown as PgBoss;
    const createBoss = vi.fn(() => boss);
    const setBoss = vi.fn();

    const result = await startAppBoss({ createBoss, setBoss });

    expect(result).toBe(boss);
    expect(didStart).toBe(true);
    expect(setBoss).toHaveBeenCalledExactlyOnceWith(boss);
  });

  it("publishes the boss only after start resolves (producers never see an unstarted boss)", async () => {
    const order: string[] = [];
    const boss = Object.assign(new EventEmitter(), {
      start: vi.fn((): Promise<PgBoss> => {
        order.push("start");
        return Promise.resolve(boss);
      }),
    }) as unknown as PgBoss;
    const createBoss = vi.fn(() => boss);
    const setBoss = vi.fn(() => {
      order.push("setBoss");
    });

    await startAppBoss({ createBoss, setBoss });

    expect(order).toEqual(["start", "setBoss"]);
  });

  it("observes actual PgBoss error events before start without logging secrets", async () => {
    const boss = new PgBoss("postgres://fixture:synthetic-secret@127.0.0.1/unused");
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setBoss = vi.fn();
    const sensitive = Object.assign(new Error("synthetic-secret in connection diagnostics"), {
      connectionString: "postgres://fixture:synthetic-secret@127.0.0.1/unused",
      queue: "import.prepare.synthetic-secret",
      data: { password: "synthetic-secret" },
    });
    vi.spyOn(boss, "start").mockImplementation(() => {
      boss.emit("error", sensitive);
      return Promise.resolve(boss);
    });

    await expect(startAppBoss({ createBoss: () => boss, setBoss })).resolves.toBe(boss);
    expect(setBoss).toHaveBeenCalledExactlyOnceWith(boss);
    expect(report).toHaveBeenCalledExactlyOnceWith("pg-boss background error", {
      code: "queue_background_error",
      source: "app",
    });
    expect(JSON.stringify(report.mock.calls)).not.toContain("synthetic-secret");
  });

  it("preserves startup rejection and never publishes the failed producer", async () => {
    const boss = new PgBoss("postgres://fixture:synthetic-secret@127.0.0.1/unused");
    const failure = new Error("synthetic startup failure");
    vi.spyOn(boss, "start").mockRejectedValue(failure);
    const setBoss = vi.fn();

    await expect(startAppBoss({ createBoss: () => boss, setBoss })).rejects.toBe(failure);
    expect(setBoss).not.toHaveBeenCalled();
  });
});
