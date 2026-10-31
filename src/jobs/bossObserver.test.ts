import { PgBoss } from "pg-boss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeBossErrors } from "./bossObserver";

function fixtureBoss() {
  return new PgBoss("postgres://fixture:synthetic-secret@127.0.0.1/unused");
}

describe("PgBoss background error observer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prevents the actual EventEmitter unhandled-error crash", () => {
    const boss = fixtureBoss();
    const failure = new Error("synthetic connection timeout");
    expect(() => boss.emit("error", failure)).toThrow(failure);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    observeBossErrors(boss, "worker");

    expect(() => boss.emit("error", failure)).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith("pg-boss background error", {
      code: "queue_background_error",
      source: "worker",
    });
  });

  it("does not inspect or serialize credential-bearing error objects", () => {
    const boss = fixtureBoss();
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitive = new Proxy(
      Object.assign(new Error("password=synthetic-secret"), { queue: "private-payload" }),
      {
        get: () => {
          throw new Error("error properties must not be inspected");
        },
      },
    );
    observeBossErrors(boss, "app");

    expect(() => boss.emit("error", sensitive)).not.toThrow();
    expect(report).toHaveBeenCalledExactlyOnceWith("pg-boss background error", {
      code: "queue_background_error",
      source: "app",
    });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(
      /password|synthetic-secret|private-payload/u,
    );
  });

  it("attaches at most one observer without replacing other listeners or boss methods", () => {
    const boss = fixtureBoss();
    const otherListener = vi.fn();
    boss.on("error", otherListener);
    const start = Object.getOwnPropertyDescriptor(boss, "start");
    const work = Object.getOwnPropertyDescriptor(boss, "work");
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    observeBossErrors(boss, "worker");
    observeBossErrors(boss, "worker");
    const failure = new Error("synthetic background error");
    boss.emit("error", failure);

    expect(boss.listenerCount("error")).toBe(2);
    expect(otherListener).toHaveBeenCalledExactlyOnceWith(failure);
    expect(report).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(boss, "start")).toEqual(start);
    expect(Object.getOwnPropertyDescriptor(boss, "work")).toEqual(work);
  });

  it("keeps a failing diagnostics sink from turning an observed error into a crash", () => {
    const boss = fixtureBoss();
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("synthetic stderr failure");
    });
    observeBossErrors(boss, "worker");
    expect(() => boss.emit("error", new Error("synthetic queue failure"))).not.toThrow();
  });
});
