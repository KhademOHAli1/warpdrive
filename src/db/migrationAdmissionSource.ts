import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "@/types/result";
import { type CanonicalMigration, parseMigrationJournal } from "./migrationAdmission";

export async function readCanonicalMigrations(
  folder: string,
  signal: AbortSignal,
): Promise<Result<CanonicalMigration[], string>> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(path.join(folder, "meta/_journal.json"), {
        encoding: "utf8",
        signal,
      }),
    );
    const journal = parseMigrationJournal(raw);
    if (!journal.ok) return journal;
    const migrations: CanonicalMigration[] = [];
    for (const entry of journal.value) {
      signal.throwIfAborted();
      const source = await readFile(path.join(folder, `${entry.tag}.sql`), {
        encoding: "utf8",
        signal,
      });
      migrations.push({
        ...entry,
        hash: createHash("sha256").update(source).digest("hex"),
        sql: source.split("--> statement-breakpoint"),
      });
    }
    signal.throwIfAborted();
    return ok(migrations);
  } catch {
    signal.throwIfAborted();
    return err("could not read canonical migration source");
  }
}
