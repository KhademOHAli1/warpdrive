import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareLineages, inspectCheckout } from "./migrationLineage";

const roots: string[] = [];
const signal = () => AbortSignal.timeout(10_000);
const hash = (sql: string) => createHash("sha256").update(sql).digest("hex");
const sql = "CREATE TABLE example(id integer);\n";
const entry = (idx: number, tag: string, when = idx + 1) => ({
  idx,
  version: "7",
  tag,
  when,
  breakpoints: true,
});
async function fixture(
  entries = [entry(0, "0000_initial")],
  files: Record<string, string> = { "0000_initial": sql },
) {
  const directory = await mkdtemp(join(tmpdir(), "warpdrive-lineage-test-"));
  roots.push(directory);
  await mkdir(join(directory, "drizzle/meta"), { recursive: true });
  await writeFile(
    join(directory, "drizzle/meta/_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
  for (const [tag, content] of Object.entries(files))
    await writeFile(join(directory, `drizzle/${tag}.sql`), content);
  return directory;
}
async function ledgerFile(directory: string, rows: unknown) {
  const path = join(directory, "ledger.json");
  await writeFile(path, JSON.stringify({ format: "drizzle-pg-ledger-v1", rows }));
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read-only migration lineage inspection", () => {
  it("hashes exact SQL bytes and never infers applied history from files", async () => {
    const directory = await fixture();
    const result = await inspectCheckout({ label: "main", directory }, signal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]).toMatchObject({
      idx: 0,
      tag: "0000_initial",
      when: 1,
      sha256: hash(sql),
    });
    expect(result.value.ledger).toEqual({ status: "not-provided", issues: [] });
    expect(result.value.qualifiesUpgrade).toBe(false);
  });

  it("compares all pairs including a third lineage and identifies true shared prefixes", async () => {
    const first = await fixture();
    const second = await fixture([entry(0, "0000_initial"), entry(1, "0001_workflows")], {
      "0000_initial": sql,
      "0001_workflows": "SELECT 1;",
    });
    const third = await fixture([entry(0, "0000_initial"), entry(1, "0001_email")], {
      "0000_initial": sql,
      "0001_email": "SELECT 2;",
    });
    const results = await Promise.all(
      [first, second, third].map((directory, index) =>
        inspectCheckout({ label: `branch${index}`, directory }, signal()),
      ),
    );
    const inventories = results.flatMap((result) => (result.ok ? [result.value] : []));
    expect(inventories).toHaveLength(3);
    expect(compareLineages(inventories)).toMatchObject([
      { left: "branch0", right: "branch1", sharedPrefix: 1, relation: "right-extends" },
      { left: "branch0", right: "branch2", sharedPrefix: 1, relation: "right-extends" },
      { left: "branch1", right: "branch2", sharedPrefix: 1, relation: "divergent" },
    ]);
  });

  it("detects changed bytes under an identical numeric tag", async () => {
    const first = await fixture();
    const second = await fixture(undefined, { "0000_initial": "SELECT 2;" });
    const a = await inspectCheckout({ label: "a", directory: first }, signal());
    const b = await inspectCheckout({ label: "b", directory: second }, signal());
    if (!a.ok || !b.ok) throw new Error("fixture inspection failed");
    expect(compareLineages([a.value, b.value])[0]).toMatchObject({
      relation: "divergent",
      sharedPrefix: 0,
      mismatch: { index: 0, fields: ["sha256"] },
    });
    expect(compareLineages([a.value, { ...a.value, label: "same" }])[0]?.relation).toBe(
      "identical",
    );
  });

  it("rejects missing SQL without a partial valid inventory", async () => {
    const directory = await fixture([entry(0, "0000_missing")], {});
    expect(await inspectCheckout({ label: "main", directory }, signal())).toMatchObject({
      ok: false,
      error: { code: "unreadable-file", file: "drizzle/0000_missing.sql" },
    });
  });

  it.each([
    [entry(0, "0000_initial"), entry(0, "0001_next")],
    [entry(0, "0000_initial"), entry(1, "0000_initial")],
    [entry(0, "0000_initial", 1), entry(1, "0001_next", 1)],
    [entry(0, "0000_initial", 2), entry(1, "0001_next", 1)],
    [entry(1, "0000_initial")],
    [entry(0, "../escape")],
  ])("rejects duplicate, out-of-order or traversing journal entries", async (...entries) => {
    const directory = await fixture(entries);
    expect(await inspectCheckout({ label: "main", directory }, signal())).toMatchObject({
      ok: false,
      error: { code: "invalid-journal" },
    });
  });

  it("rejects unjournaled SQL from an incomplete chain", async () => {
    const directory = await fixture();
    await writeFile(join(directory, "drizzle/0001_unjournaled.sql"), "SELECT 1;");
    expect(await inspectCheckout({ label: "main", directory }, signal())).toMatchObject({
      ok: false,
      error: { code: "unjournaled-sql" },
    });
  });

  it("rejects SQL that resolves outside the supplied checkout", async () => {
    const directory = await fixture([entry(0, "0000_escape")], {});
    const outside = await fixture();
    await symlink(
      join(outside, "drizzle/0000_initial.sql"),
      join(directory, "drizzle/0000_escape.sql"),
    );
    expect(await inspectCheckout({ label: "main", directory }, signal())).toMatchObject({
      ok: false,
      error: { code: "outside-checkout" },
    });
  });

  it("matches an exported ledger prefix without certifying upgrade safety", async () => {
    const directory = await fixture();
    const ledger = await ledgerFile(directory, [{ hash: hash(sql), created_at: "1" }]);
    const result = await inspectCheckout(
      { label: "main", directory, ledgerFile: ledger },
      signal(),
    );
    if (!result.ok) throw new Error("fixture inspection failed");
    expect(result.value.ledger).toEqual({
      status: "matching-prefix",
      appliedCount: 1,
      pendingCount: 0,
      issues: [],
    });
    expect(result.value.qualifiesUpgrade).toBe(false);
  });

  it.each([
    [{ hash: "f".repeat(64), created_at: 1 }],
    [{ hash: "f".repeat(64), created_at: 123 }],
    [{ hash: hash(sql), created_at: 2 }],
    [
      { hash: hash(sql), created_at: 1 },
      { hash: hash(sql), created_at: 1 },
    ],
  ])("blocks unknown, changed, timestamp-mismatched and duplicate ledger rows", async (...rows) => {
    const directory = await fixture();
    const ledger = await ledgerFile(directory, rows);
    const result = await inspectCheckout(
      { label: "main", directory, ledgerFile: ledger },
      signal(),
    );
    if (!result.ok) throw new Error("fixture inspection failed");
    expect(result.value.ledger.status).toBe("mismatch");
    expect(result.value.ledger.issues.length).toBeGreaterThan(0);
  });

  it("rejects a ledger that skips a known migration", async () => {
    const nextSql = "SELECT 2;";
    const directory = await fixture([entry(0, "0000_initial"), entry(1, "0001_next")], {
      "0000_initial": sql,
      "0001_next": nextSql,
    });
    const ledger = await ledgerFile(directory, [{ hash: hash(nextSql), created_at: 2 }]);
    const result = await inspectCheckout(
      { label: "main", directory, ledgerFile: ledger },
      signal(),
    );
    if (!result.ok) throw new Error("fixture inspection failed");
    expect(result.value.ledger).toMatchObject({
      status: "mismatch",
      issues: ["non-prefix-ledger"],
    });
  });

  it("rejects malformed exports without echoing input fields", async () => {
    const directory = await fixture();
    const ledger = await ledgerFile(directory, [{ secret: "never-print-this" }]);
    const result = await inspectCheckout(
      { label: "main", directory, ledgerFile: ledger },
      signal(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-ledger" } });
    expect(JSON.stringify(result)).not.toContain("never-print-this");
  });

  it("propagates cancellation", async () => {
    const directory = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectCheckout({ label: "main", directory }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("migration inspection CLI", () => {
  it("requires explicit roots and rejects duplicate or unmatched labels", async () => {
    const { runLineageInspection } = await import("./check-migration-lineage");
    for (const args of [
      [],
      ["--checkout", "same=/a", "--checkout", "same=/b"],
      ["--checkout", "main=/a", "--ledger", "unknown=/b"],
      ["--env-file", "secret.env"],
    ]) {
      const result = await runLineageInspection(args, signal());
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatchObject({ status: "invalid-cli-arguments" });
    }
  });

  it("returns an evidence gap without an exported ledger, even for valid source", async () => {
    const { runLineageInspection } = await import("./check-migration-lineage");
    const directory = await fixture();
    const result = await runLineageInspection(["--checkout", `main=${directory}`], signal());
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatchObject({ qualifiesUpgrade: false });
  });

  it("returns success only for matching supplied ledgers while still withholding qualification", async () => {
    const { runLineageInspection } = await import("./check-migration-lineage");
    const directory = await fixture();
    const ledger = await ledgerFile(directory, [{ hash: hash(sql), created_at: 1 }]);
    const result = await runLineageInspection(
      ["--checkout", `main=${directory}`, "--ledger", `main=${ledger}`],
      signal(),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({ qualifiesUpgrade: false });
  });
});

describe("filesystem admission", () => {
  it("rejects a named pipe without blocking while opening it", async () => {
    const directory = await fixture([entry(0, "0000_pipe")], {});
    const pipe = join(directory, "drizzle/0000_pipe.sql");
    expect(spawnSync("mkfifo", [pipe]).status).toBe(0);
    const inspected = spawnSync(
      process.execPath,
      ["scripts/sales-platform/check-migration-lineage.ts", "--checkout", `main=${directory}`],
      { timeout: 1000, encoding: "utf8" },
    );
    expect(inspected.status).toBe(1);
    expect(inspected.signal).toBeNull();
    expect(inspected.stdout).toContain("file-limit-or-type");
  });
});
