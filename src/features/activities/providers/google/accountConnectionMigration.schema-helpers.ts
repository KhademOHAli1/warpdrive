import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { TestDb } from "@/test/db";

const GENERATION_MIGRATION = "0091_calendar_connection_generation";
const source = fileURLToPath(new URL("../../../../../drizzle", import.meta.url));
const archive = fileURLToPath(
  new URL("../../../../../docs/migration-history/calendar-original", import.meta.url),
);
const journalSchema = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z.object({
      idx: z.number().int(),
      version: z.string(),
      when: z.number(),
      tag: z.string(),
      breakpoints: z.boolean(),
    }),
  ),
});
type Journal = z.infer<typeof journalSchema>;

function copyHistory(folder: string, journal: Journal, entries: Journal["entries"]) {
  mkdirSync(join(folder, "meta"), { recursive: true });
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    copyFileSync(
      join(existsSync(join(archive, `${entry.tag}.sql`)) ? archive : source, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    );
}

export async function legacyCalendarSchema(ctx: TestDb, signal: AbortSignal) {
  // A migrated template is rebuilt only inside makeTestDb's unique disposable clone.
  if (!/^\/t_[a-f0-9]{32}$/.test(new URL(ctx.url).pathname))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "migration fixture requires an owned test database");
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(archive, "_journal.json"), "utf8")),
  );
  const target = journal.entries.find((entry) => entry.tag === GENERATION_MIGRATION);
  if (target === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Calendar generation migration missing");
  const temporary = mkdtempSync(join(tmpdir(), "warpdrive-calendar-generation-migration-"));
  const before = join(temporary, "before");
  const upgraded = join(temporary, "upgraded");
  const cleanup = () => rmSync(temporary, { recursive: true });
  try {
    copyHistory(
      before,
      journal,
      journal.entries.filter((entry) => entry.idx < target.idx),
    );
    copyHistory(
      upgraded,
      journal,
      journal.entries.filter((entry) => entry.idx <= target.idx),
    );
    signal.throwIfAborted();
    await ctx.pool.query(
      "DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext",
    );
    signal.throwIfAborted();
    await migrate(ctx.db, { migrationsFolder: before });
    signal.throwIfAborted();
    return {
      upgrade: async (upgradeSignal: AbortSignal) => {
        upgradeSignal.throwIfAborted();
        // This is the preserved, unadmitted proposal history, exercised only in an isolated fixture.
        // Future migrations can be added without changing this migration's boundary.
        await migrate(ctx.db, { migrationsFolder: upgraded });
        upgradeSignal.throwIfAborted();
      },
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
