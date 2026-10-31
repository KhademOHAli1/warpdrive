import { readdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../src/types/result";
import { gitBlobHash, gitText, sha256 } from "./mail-migration-git";
import type { PlanFailure, ReconciliationPlan } from "./mail-migration-plan";

export function migrationMap(plan: ReconciliationPlan): string {
  const rows = plan.stages
    .map(
      (stage) =>
        `| ${stage.sourceTag} | ${stage.targetTag} | ${stage.sourceWhen} | ${stage.when} | ${stage.sqlHash} |`,
    )
    .join("\n");
  const snapshots = plan.stages
    .map(
      (stage) =>
        `| ${stage.targetIdx} | ${stage.id} | ${stage.prevId} | ${stage.tableCount} | ${stage.structureHash} |`,
    )
    .join("\n");
  return `# Integrated mail migration map

This candidate preserves the active local88 mail preview. It reconciles immutable source cuts only; PostgreSQL upgrade, clean-install, restore and installed-provider qualification are separate gates. Fingerprint91 remains reserved and is not implemented here.

Platform: \`${plan.platformRef}\`. Mail: \`${plan.mailRef}\`. Actual common82 snapshot SHA256: \`${plan.baselineHash}\`. Snapshot82 and all historical SQL/snapshots0..82 were compared through their actual Git blobs, with identical journal entries0..82.

## Forward mapping

Platform SQL/snapshots0..84 remain byte-identical. Existing journal bytes through entry84 are retained as a prefix. Each new timestamp exceeds platform84 and the preceding addition; retaining the earlier local-mail timestamps would silently skip the migrations on a platform84 upgrade.

| Original mail tag | Integrated tag | Original timestamp | Forward timestamp | Exact SQL SHA256 |
| --- | --- | --- | --- | --- |
${rows}

## Metadata chain

The recursive three-way merge uses actual common82, platform84 and each cumulative mail snapshot. An unchanged side retains the other side; identical changes coalesce. Disjoint object keys recurse. Ordered arrays remain atomic. Scalar conflicts, delete/edit collisions and competing new objects stop with exact JSON paths. Only snapshot id/prevId are replaced. Conflict count: **0**.

| Entry | Fresh snapshot ID | Previous ID | Tables | Structural SHA256 excluding IDs |
| --- | --- | --- | --- | --- |
${snapshots}

Structural hashes use recursively sorted JSON object keys, retaining array order. All seven platform table definitions remain intact alongside the mail tables and six modified email tables.

## Guards and remaining qualification

The platform84 SQL is retained unchanged, including the SQL-only \`workflows_published_version_fk\`, \`workflow_version_immutable()\` and \`workflow_versions_immutable\` trigger. Snapshot/no-schema-diff checks cannot establish these custom guards; PostgreSQL tests must inspect and exercise them. Mail87 retains the corrected ordering that creates \`email_messages_id_account_uq\` before its locator composite FK, and retains Gmail UUID/provider-identity backfills.

The script does not modify schemas, credentials, runtime configuration, original previews or Git history. Obsolete isolated-mail SQL names are removed only in this candidate. The six forward SQL bodies are exact copies under new names. Divergent installed/local88 histories need a separate qualified path; this sequence is for the agreed platform84 baseline.

Reproduce in a fresh pending merge of the two immutable cuts:

\`bun scripts/mail-migration-reconcile.ts --root <isolated-candidate> --platform ${plan.platformRef} --mail ${plan.mailRef}\`

The default is read-only. Add \`--write\` only for the isolated candidate: it checks exact HEAD/MERGE_HEAD, historical file hashes and absence of unexpected migration files before writing. It never stages or commits. Tests: \`bun run test:unit scripts/mail-migration\`.
`;
}

async function checkMigrationPaths(
  plan: ReconciliationPlan,
  signal: AbortSignal,
): Promise<Result<true, PlanFailure>> {
  const allowed = new Set([
    ...plan.preservedFiles.keys(),
    ...plan.outputs.keys(),
    ...plan.obsoleteSql,
  ]);
  for (const directory of ["drizzle", "drizzle/meta"]) {
    const entries = await readdir(join(plan.root, directory), { withFileTypes: true });
    signal.throwIfAborted();
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory() && path === "drizzle/meta") continue;
      if (!entry.isFile() || !allowed.has(path))
        return err({ kind: "unexpected_migration_path", paths: [path] });
    }
  }
  return ok(true);
}

async function preflight(
  plan: ReconciliationPlan,
  signal: AbortSignal,
): Promise<Result<true, PlanFailure>> {
  const [head, mergeHead, top] = await Promise.all([
    gitText(plan.root, ["rev-parse", "HEAD"], signal),
    gitText(plan.root, ["rev-parse", "MERGE_HEAD"], signal),
    gitText(plan.root, ["rev-parse", "--show-toplevel"], signal),
  ]);
  if (
    head.trim() !== plan.platformRef ||
    mergeHead.trim() !== plan.mailRef ||
    (await realpath(top.trim())) !== (await realpath(plan.root))
  )
    return err({ kind: "wrong_candidate_or_merge", paths: [] });
  for (const [path, oid] of plan.preservedFiles) {
    if (plan.outputs.has(path)) continue;
    if (gitBlobHash(await readFile(join(plan.root, path), { signal })) !== oid)
      return err({ kind: "historical_worktree_drift", paths: [path] });
  }
  const paths = await checkMigrationPaths(plan, signal);
  if (!paths.ok) return paths;
  for (const [index, path] of plan.obsoleteSql.entries()) {
    const bytes = await readFile(join(plan.root, path), { signal });
    if (sha256(bytes) !== plan.stages[index]?.sqlHash)
      return err({ kind: "obsolete_mail_sql_drift", paths: [path] });
  }
  return ok(true);
}

export async function writeMailMigrationCandidate(
  plan: ReconciliationPlan,
  signal: AbortSignal,
): Promise<Result<true, PlanFailure>> {
  try {
    const checked = await preflight(plan, signal);
    if (!checked.ok) return checked;
    for (const [path, bytes] of plan.outputs)
      await writeFile(join(plan.root, path), bytes, { signal });
    for (const path of plan.obsoleteSql) await unlink(join(plan.root, path));
    for (const [path, oid] of plan.preservedFiles)
      if (gitBlobHash(await readFile(join(plan.root, path), { signal })) !== oid)
        return err({ kind: "historical_output_drift", paths: [path] });
    await writeFile(join(plan.root, "docs/mail-integrated-migration-map.md"), migrationMap(plan), {
      signal,
    });
    signal.throwIfAborted();
    return ok(true);
  } catch {
    signal.throwIfAborted();
    return err({ kind: "candidate_io_failed", paths: [] });
  }
}
