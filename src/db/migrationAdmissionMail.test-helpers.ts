import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect } from "vitest";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import { parseMigrationJournal } from "./migrationAdmission";
import { canonicalFolder, ledger } from "./migrationAdmission.test-helpers";

export const mailFunctions = [
  "email_delivery_report_guard()",
  "email_delivery_review_guard()",
  "private_intake_hash_v1(jsonb)",
  "private_intake_message_v1(public.email_messages)",
  "private_intake_thread_v1(public.email_threads)",
  "private_intake_attachment_v1(public.email_message_attachments)",
  "private_intake_baseline_v1(uuid,uuid)",
  "private_intake_assert_owned_v1(public.email_private_intake)",
  "email_private_intake_guard()",
  "email_private_intake_review_guard()",
];
export const mailTriggers = [
  {
    name: "email_delivery_reports_immutable",
    table: "email_delivery_reports",
    function: "email_delivery_report_guard",
    events: "UPDATE OR DELETE",
  },
  {
    name: "email_delivery_reviews_immutable",
    table: "email_delivery_reviews",
    function: "email_delivery_review_guard",
    events: "UPDATE OR DELETE",
  },
  {
    name: "email_private_intake_immutable",
    table: "email_private_intake",
    function: "email_private_intake_guard",
    events: "INSERT OR UPDATE OR DELETE",
  },
  {
    name: "email_private_intake_reviews_immutable",
    table: "email_private_intake_reviews",
    function: "email_private_intake_review_guard",
    events: "INSERT OR UPDATE OR DELETE",
  },
];
export const mailPointers = [
  {
    name: "email_delivery_review_attempt_same_account_fk",
    table: "email_delivery_reviews",
    pointer: "attempt_id",
    target: "email_send_attempts",
  },
  {
    name: "email_private_intake_message_same_account_fk",
    table: "email_private_intake",
    pointer: "owned_message_id",
    target: "email_messages",
  },
  {
    name: "email_private_intake_attempt_same_account_fk",
    table: "email_private_intake",
    pointer: "confirmation_attempt_id",
    target: "email_send_attempts",
  },
];

type MailPointer = (typeof mailPointers)[number];
type MailPointerChange =
  | "missing"
  | "wrong_null_column"
  | "all_null_columns"
  | "nullable_account"
  | "wrong_target"
  | "update_cascade"
  | "unvalidated";

function pointerReplacement(pointer: MailPointer, change: MailPointerChange): string {
  const nullColumns =
    change === "wrong_null_column"
      ? " (account_id)"
      : change === "all_null_columns"
        ? ""
        : ` (${pointer.pointer})`;
  const target =
    change === "wrong_target"
      ? pointer.target === "email_messages"
        ? "email_send_attempts"
        : "email_messages"
      : pointer.target;
  const update = change === "update_cascade" ? "CASCADE" : "NO ACTION";
  const validation = change === "unvalidated" ? " NOT VALID" : "";
  return `ALTER TABLE public.${pointer.table} ADD CONSTRAINT ${pointer.name} FOREIGN KEY (${pointer.pointer},account_id) REFERENCES public.${target}(id,account_id) ON DELETE SET NULL${nullColumns} ON UPDATE ${update}${validation}`;
}

export async function changeMailPointer(
  h: TestDb,
  pointer: MailPointer,
  change: MailPointerChange,
): Promise<void> {
  if (change === "nullable_account") {
    await h.pool.query(`ALTER TABLE public.${pointer.table} ALTER COLUMN account_id DROP NOT NULL`);
    return;
  }
  await h.pool.query(`ALTER TABLE public.${pointer.table} DROP CONSTRAINT ${pointer.name}`);
  if (change === "missing") return;
  await h.pool.query(pointerReplacement(pointer, change));
}

export async function assertMailRefusal(h: TestDb): Promise<void> {
  const before = await ledger(h);
  expect(await applyMigrations(h.db)).toEqual({
    ok: false,
    error: "canonical mail integrity checks failed",
  });
  expect(await ledger(h)).toEqual(before);
}

export async function canonicalEntries() {
  const raw: unknown = JSON.parse(
    await readFile(join(canonicalFolder, "meta/_journal.json"), "utf8"),
  );
  const parsed = parseMigrationJournal(raw);
  if (!parsed.ok) throw new TypeError(parsed.error);
  return parsed.value;
}

export async function installOriginalMailHistory(h: TestDb): Promise<void> {
  const archiveRoot = fileURLToPath(new URL("../../docs/migration-history", import.meta.url));
  const archive = join(archiveRoot, "mail-original");
  const baseline = await mkdtemp(join(tmpdir(), "warpdrive-original-mail-migration-"));
  try {
    await mkdir(join(baseline, "meta"));
    const raw: unknown = JSON.parse(await readFile(join(archive, "_journal.json"), "utf8"));
    const original = parseMigrationJournal(raw);
    if (!original.ok) throw new TypeError(original.error);
    const commonTags = new Set((await canonicalEntries()).map((entry) => entry.tag));
    await copyFile(join(archive, "_journal.json"), join(baseline, "meta/_journal.json"));
    for (const entry of original.value) {
      let source = commonTags.has(entry.tag) ? canonicalFolder : archive;
      if (["0083_integration_connections", "0084_visual_workflows"].includes(entry.tag))
        source = join(archiveRoot, "platform-original");
      await copyFile(join(source, `${entry.tag}.sql`), join(baseline, `${entry.tag}.sql`));
    }
    // Fixture establishment only. Current admission always invokes applyMigrations instead.
    await migrate(h.db, { migrationsFolder: baseline });
  } finally {
    await rm(baseline, { recursive: true, force: true });
  }
}
