import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CanonicalMigration,
  parseMigrationJournal,
  validateMigrationLedger,
} from "./migrationAdmission";

type Entry = { idx: number; version: "7"; when: number; tag: string; breakpoints: boolean };
const entries: [Entry, Entry] = [
  { idx: 0, version: "7", when: 1000, tag: "0000_first", breakpoints: true },
  { idx: 1, version: "7", when: 2000, tag: "0001_second", breakpoints: true },
];
const journal = () => ({ version: "7", dialect: "postgresql", entries: structuredClone(entries) });
const migrations: CanonicalMigration[] = entries.map((entry, index) => ({
  ...entry,
  hash: (index === 0 ? "a" : "b").repeat(64),
  sql: ["SELECT 1"],
}));
type Row = { id: number; hash: string; created_at: string };
const rows = (): [Row, Row] =>
  migrations.map((migration, index) => ({
    id: index + 1,
    hash: migration.hash,
    created_at: String(migration.when),
  })) as [Row, Row];

describe("canonical source journal admission", () => {
  it("preserves the exact ordered trusted journal", () => {
    expect(parseMigrationJournal(journal())).toEqual({ ok: true, value: entries });
  });

  it.each([
    [
      "missing position",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].idx = 2;
      },
    ],
    [
      "repeated position",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].idx = 0;
      },
    ],
    [
      "backward time",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].when = 999;
      },
    ],
    [
      "duplicate time",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].when = 1000;
      },
    ],
    [
      "wrong file prefix",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].tag = "0083_foreign";
      },
    ],
    [
      "path traversal",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].tag = "../foreign";
      },
    ],
    [
      "unsafe time",
      (value: ReturnType<typeof journal>) => {
        value.entries[1].when = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
  ])("refuses %s before loading SQL", (_name, change) => {
    const value = journal();
    change(value);
    expect(parseMigrationJournal(value).ok).toBe(false);
  });

  it("refuses an empty or unsupported journal", () => {
    expect(parseMigrationJournal({ ...journal(), entries: [] }).ok).toBe(false);
    expect(parseMigrationJournal({ ...journal(), dialect: "sqlite" }).ok).toBe(false);
    expect(parseMigrationJournal({ ...journal(), extra: true }).ok).toBe(false);
  });
});

describe("complete ordered migration ledger admission", () => {
  it("admits fresh, exact partial-prefix and complete no-op histories", () => {
    expect(validateMigrationLedger(migrations, [])).toEqual({ ok: true, value: 0 });
    expect(validateMigrationLedger(migrations, rows().slice(0, 1))).toEqual({ ok: true, value: 1 });
    expect(validateMigrationLedger(migrations, rows())).toEqual({ ok: true, value: 2 });
  });

  it("retains legitimate serial gaps rather than rewriting database IDs", () => {
    const value = rows();
    value[0].id = 4;
    value[1].id = 9;
    expect(validateMigrationLedger(migrations, value)).toEqual({ ok: true, value: 2 });
  });

  it.each([
    [
      "earlier changed hash",
      (value: ReturnType<typeof rows>) => {
        value[0].hash = "c".repeat(64);
      },
    ],
    [
      "foreign earlier timestamp",
      (value: ReturnType<typeof rows>) => {
        value[0].created_at = "999";
      },
    ],
    [
      "foreign high cutoff",
      (value: ReturnType<typeof rows>) => {
        value[1].created_at = "1793520048557";
      },
    ],
    [
      "missing middle migration",
      (value: ReturnType<typeof rows>) => {
        value.shift();
      },
    ],
    [
      "reordered history",
      (value: ReturnType<typeof rows>) => {
        value.reverse();
      },
    ],
    [
      "duplicate database ID",
      (value: ReturnType<typeof rows>) => {
        value[1].id = 1;
      },
    ],
    [
      "duplicate timestamp",
      (value: ReturnType<typeof rows>) => {
        value[1].created_at = "1000";
      },
    ],
    [
      "unknown extra row",
      (value: ReturnType<typeof rows>) => {
        value.push({ ...value[1], id: 3 });
      },
    ],
    [
      "malformed timestamp",
      (value: ReturnType<typeof rows>) => {
        value[1].created_at = "NaN";
      },
    ],
  ])("rejects %s even when the last row could make Drizzle select no SQL", (_name, change) => {
    const value = rows();
    change(value);
    expect(validateMigrationLedger(migrations, value).ok).toBe(false);
  });

  it("routes the ordinary operator command through the shared admission runner", () => {
    const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["db:migrate"]).toBe("bun --bun src/entrypoints/migrate.ts");
  });
});
