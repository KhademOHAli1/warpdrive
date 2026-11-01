import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareMailMigrationReconciliation } from "./mail-migration-plan";
import { writeMailMigrationCandidate } from "./mail-migration-write";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const platformRef = "b8b2708d4076551b803451ce10d4928a87ce35cd";
const mailRef = "297c1dd5dbff4e19f6d1559a16bb258cc3368577";

// Shallow CI clones lack the immutable operator inputs. Pure structural tests still run;
// qualification is explicit here rather than fetching history during a unit test.
const cutsAvailable = [platformRef, mailRef].every(
  (ref) =>
    spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], {
      cwd: root,
      timeout: 2000,
      stdio: "ignore",
    }).status === 0,
);

describe.runIf(cutsAvailable)("immutable mail migration plan (requires source cuts)", () => {
  it("refuses a write under mismatched merge authority without touching the journal", async () => {
    const signal = AbortSignal.timeout(20_000);
    const plan = await prepareMailMigrationReconciliation({ root, platformRef, mailRef, signal });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const path = resolve(root, "drizzle/meta/_journal.json");
    const before = await readFile(path, { signal });
    expect(
      (await writeMailMigrationCandidate({ ...plan.value, platformRef: mailRef }, signal)).ok,
    ).toBe(false);
    expect(await readFile(path, { signal })).toEqual(before);
  });
  it("replays the real common82 and both immutable cuts without metadata loss", async () => {
    const result = await prepareMailMigrationReconciliation({
      root,
      platformRef,
      mailRef,
      signal: AbortSignal.timeout(20_000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.baselineHash).toBe(
      "3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a",
    );
    expect(result.value.stages.map((stage) => [stage.targetIdx, stage.tableCount])).toEqual([
      [85, 89],
      [86, 90],
      [87, 92],
      [88, 92],
      [89, 92],
      [90, 92],
    ]);
    expect(result.value.stages.at(-1)?.structureHash).toBe(
      "89cbe4c572fdc275828d9ffca7022e8c212fa145ab3ca0a4bf572511f9068056",
    );
    expect(result.value.stages.map((stage) => stage.when)).toEqual([
      1793452709229, 1793452709230, 1793452709231, 1793452709232, 1793452709233, 1793452709234,
    ]);
    expect(result.value.stages[0]?.prevId).toBe("d447ce0b-f2b8-4142-ab52-9b89b09d81af");
    for (let index = 1; index < result.value.stages.length; index += 1)
      expect(result.value.stages[index]?.prevId).toBe(result.value.stages[index - 1]?.id);
    expect(result.value.outputs.has("drizzle/0085_natural_deathstrike.sql")).toBe(true);
    expect(result.value.outputs.has("drizzle/0091_mail_locator_source_fingerprint.sql")).toBe(
      false,
    );
    expect(result.value.obsoleteSql).toHaveLength(6);
  });

  it("retains exact mail SQL hashes including corrected composite FK ordering", async () => {
    const result = await prepareMailMigrationReconciliation({
      root,
      platformRef,
      mailRef,
      signal: AbortSignal.timeout(20_000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stages.map((stage) => stage.sqlHash)).toEqual([
      "3a91f34acc7a9ba493425fc703d739dfab7ca71cc5e568d9940e1c8b5b4fed9b",
      "562d6affd4ddcb70a5d9baa0ba2ac076dd5e04b32e2113e759c18471725e04e2",
      "87171bd516d517c20756b2ce09efedf7ea0a88cd6dba58d2635bdab21ee4157f",
      "e98695888d8aec834ccdff77340d5123089b335d6f011e76d4815bd89e0b2a57",
      "6b951166dd50bdc38ee2855d0044d3a948eff9b65c355a3fd3f970b08a540586",
      "63f9f00ae03c629b64e84a40f9d69dd21685bcafb63cb2bef609630d10e35fb0",
    ]);
    const sql = result.value.outputs.get("drizzle/0087_cooing_night_nurse.sql")?.toString() ?? "";
    expect(sql.indexOf('ADD CONSTRAINT "email_messages_id_account_uq"')).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "mail_locator_message_same_account_fk"'),
    );
    expect(sql).toContain('UPDATE "email_threads" SET "provider_thread_id"="gmail_thread_id"');
  });
});

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
