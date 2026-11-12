import { afterEach, expect, it, vi } from "vitest";
import { runMigrationsCli } from "@/db/migrate";

const fixture = vi.hoisted(() => ({
  env: {
    MIGRATION_DATABASE_URL: "",
    DATABASE_URL: "postgres://runtime:synthetic-secret@127.0.0.1/unused",
  },
  createPool: vi.fn(),
}));
vi.mock("@/config/env", () => ({ env: fixture.env }));
vi.mock("pg", () => ({ Pool: fixture.createPool, default: { Pool: fixture.createPool } }));
afterEach(() => vi.restoreAllMocks());

it.each(["", "   "])(
  "requires an explicit owner DSN before constructing any Pool (%j)",
  async (dsn) => {
    fixture.env.MIGRATION_DATABASE_URL = dsn;
    fixture.createPool.mockClear();
    const terminated = new Error("fixture exit");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw terminated;
    });
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runMigrationsCli()).rejects.toBe(terminated);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.createPool).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledExactlyOnceWith(
      "migration failed: explicit migration database URL required",
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain("synthetic-secret");
  },
);
