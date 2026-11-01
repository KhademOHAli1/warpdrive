import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { err, ok, type Result } from "../src/types/result";
import {
  commitSchema,
  gitBlob,
  gitDrizzleTree,
  sha256,
  sqlOrSnapshotIndex,
} from "./mail-migration-git";
import {
  appendForwardJournal,
  type JournalEntry,
  type JsonValue,
  journalSchema,
  mergeSnapshot,
  type Snapshot,
  snapshotSchema,
} from "./mail-migration-merge";

export interface MigrationStage {
  sourceTag: string;
  targetTag: string;
  targetIdx: number;
  when: number;
  sourceWhen: number;
  id: string;
  prevId: string;
  tableCount: number;
  sqlHash: string;
  structureHash: string;
}
export interface ReconciliationPlan {
  root: string;
  platformRef: string;
  mailRef: string;
  baselineHash: string;
  outputs: Map<string, Buffer>;
  preservedFiles: Map<string, string>;
  obsoleteSql: string[];
  stages: MigrationStage[];
}
export type PlanFailure = { kind: string; paths: string[] };

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function compatibleJournals(platform: JournalEntry[], mail: JournalEntry[]): boolean {
  return (
    platform.at(-1)?.idx === 84 &&
    mail.at(-1)?.idx === 88 &&
    isDeepStrictEqual(platform.slice(0, 83), mail.slice(0, 83))
  );
}

function findBaselineConflicts(platform: Map<string, string>, mail: Map<string, string>): string[] {
  const paths = new Set(
    [...platform.keys(), ...mail.keys()].filter((path) => {
      const index = sqlOrSnapshotIndex(path);
      return index !== null && index <= 82;
    }),
  );
  return [...paths].filter((path) => platform.get(path) !== mail.get(path));
}

function assembleMailStages(args: {
  base: Snapshot;
  platform: Snapshot;
  mailStages: Snapshot[];
  mailEntries: JournalEntry[];
  targets: JournalEntry[];
  sqlBodies: Buffer[];
}): Result<{ outputs: Map<string, Buffer>; stages: MigrationStage[] }, PlanFailure> {
  const outputs = new Map<string, Buffer>();
  const stages: MigrationStage[] = [];
  let previousMailId = args.base.id;
  let previousCombinedId = args.platform.id;
  for (const [index, snapshot] of args.mailStages.entries()) {
    const source = args.mailEntries[index];
    const target = args.targets[index];
    const sql = args.sqlBodies[index];
    if (
      source === undefined ||
      target === undefined ||
      sql === undefined ||
      snapshot.prevId !== previousMailId
    )
      return err({ kind: "invalid_mail_chain", paths: [] });
    const merged = mergeSnapshot(
      args.base,
      args.platform,
      snapshot,
      previousCombinedId,
      randomUUID(),
    );
    if (!merged.ok) return merged;
    const { id, prevId, ...structure } = merged.value;
    stages.push({
      sourceTag: source.tag,
      targetTag: target.tag,
      targetIdx: target.idx,
      when: target.when,
      sourceWhen: source.when,
      id,
      prevId,
      tableCount: Object.keys(merged.value.tables).length,
      sqlHash: sha256(sql),
      structureHash: sha256(JSON.stringify(canonical(structure))),
    });
    outputs.set(`drizzle/${target.tag}.sql`, sql);
    outputs.set(
      `drizzle/meta/${String(target.idx).padStart(4, "0")}_snapshot.json`,
      Buffer.from(`${JSON.stringify(merged.value, null, 2)}\n`),
    );
    previousMailId = snapshot.id;
    previousCombinedId = id;
  }
  return ok({ outputs, stages });
}

export async function prepareMailMigrationReconciliation(args: {
  root: string;
  platformRef: string;
  mailRef: string;
  signal: AbortSignal;
}): Promise<Result<ReconciliationPlan, PlanFailure>> {
  const { root, platformRef, mailRef, signal } = args;
  if (!commitSchema.safeParse(platformRef).success || !commitSchema.safeParse(mailRef).success)
    return err({ kind: "invalid_commit", paths: [] });
  try {
    const [platformTree, mailTree] = await Promise.all([
      gitDrizzleTree(root, platformRef, signal),
      gitDrizzleTree(root, mailRef, signal),
    ]);
    if (platformTree === null || mailTree === null) return err({ kind: "invalid_tree", paths: [] });
    const baselineConflicts = findBaselineConflicts(platformTree, mailTree);
    if (baselineConflicts.length > 0)
      return err({ kind: "baseline_conflict", paths: baselineConflicts });
    const [platformJournalRaw, mailJournalRaw] = await Promise.all([
      gitBlob(root, platformRef, "drizzle/meta/_journal.json", signal),
      gitBlob(root, mailRef, "drizzle/meta/_journal.json", signal),
    ]);
    const platformJson: unknown = JSON.parse(platformJournalRaw.toString());
    const mailJson: unknown = JSON.parse(mailJournalRaw.toString());
    const platformJournal = journalSchema.safeParse(platformJson);
    const mailJournal = journalSchema.safeParse(mailJson);
    if (!platformJournal.success || !mailJournal.success)
      return err({ kind: "invalid_journal", paths: [] });
    if (!compatibleJournals(platformJournal.data.entries, mailJournal.data.entries))
      return err({ kind: "journal_baseline_conflict", paths: ["drizzle/meta/_journal.json"] });
    const mailEntries = mailJournal.data.entries.filter((entry) => entry.idx >= 83);
    const targetTags = mailEntries.map(
      (entry) => `${String(entry.idx + 2).padStart(4, "0")}${entry.tag.slice(4)}`,
    );
    const forward = appendForwardJournal(platformJournalRaw.toString(), targetTags);
    if (!forward.ok) return forward;
    const snapshotPaths = [
      "drizzle/meta/0082_snapshot.json",
      "drizzle/meta/0083_snapshot.json",
      "drizzle/meta/0084_snapshot.json",
    ];
    const [platformSnapshots, mailSnapshots, sqlBodies] = await Promise.all([
      Promise.all(snapshotPaths.map((path) => gitBlob(root, platformRef, path, signal))),
      Promise.all(
        [82, ...mailEntries.map((entry) => entry.idx)].map((idx) =>
          gitBlob(
            root,
            mailRef,
            `drizzle/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
            signal,
          ),
        ),
      ),
      Promise.all(
        mailEntries.map((entry) => gitBlob(root, mailRef, `drizzle/${entry.tag}.sql`, signal)),
      ),
    ]);
    const baseRaw = platformSnapshots[0];
    const mailBaseRaw = mailSnapshots[0];
    if (baseRaw === undefined || mailBaseRaw === undefined || !baseRaw.equals(mailBaseRaw))
      return err({ kind: "snapshot_baseline_conflict", paths: [] });
    const decoded: unknown[] = [...platformSnapshots, ...mailSnapshots.slice(1)].map((bytes) =>
      JSON.parse(bytes.toString()),
    );
    const snapshots = snapshotSchema.array().safeParse(decoded);
    if (!snapshots.success) return err({ kind: "invalid_snapshot", paths: [] });
    const [base, platform83, platform84, ...mailStages] = snapshots.data;
    if (
      base === undefined ||
      platform83 === undefined ||
      platform84 === undefined ||
      platform83.prevId !== base.id ||
      platform84.prevId !== platform83.id
    )
      return err({ kind: "invalid_platform_chain", paths: [] });
    const assembled = assembleMailStages({
      base,
      platform: platform84,
      mailStages,
      mailEntries,
      targets: forward.value.entries,
      sqlBodies,
    });
    if (!assembled.ok) return assembled;
    const { outputs, stages } = assembled.value;
    const platform83Raw = platformSnapshots[1];
    const platform84Raw = platformSnapshots[2];
    if (stages.length !== 6 || platform83Raw === undefined || platform84Raw === undefined)
      return err({ kind: "incomplete_mail_chain", paths: [] });
    outputs.set("drizzle/meta/0083_snapshot.json", platform83Raw);
    outputs.set("drizzle/meta/0084_snapshot.json", platform84Raw);
    outputs.set("drizzle/meta/_journal.json", Buffer.from(forward.value.text));
    return ok({
      root,
      platformRef,
      mailRef,
      baselineHash: sha256(baseRaw),
      outputs,
      preservedFiles: new Map(
        [...platformTree].filter(([path]) => path !== "drizzle/meta/_journal.json"),
      ),
      obsoleteSql: mailEntries.map((entry) => `drizzle/${entry.tag}.sql`),
      stages,
    });
  } catch {
    signal.throwIfAborted();
    return err({ kind: "git_or_json_read_failed", paths: [] });
  }
}
