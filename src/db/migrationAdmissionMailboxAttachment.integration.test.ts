import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import type { TestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  ledger,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

const legacyTypes = ["deal", "person", "organization", "activity", "email_message"] as const;
type LegacyType = (typeof legacyTypes)[number];
const retainedTables = [
  "users",
  "pipelines",
  "stages",
  "organizations",
  "persons",
  "deals",
  "activity_types",
  "activities",
  "files",
  "email_accounts",
  "email_threads",
  "email_messages",
  "email_message_attachments",
  "email_drafts",
  "email_thread_reads",
  "email_read_intents",
] as const;

async function retainedRows(h: TestDb): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const table of retainedTables) {
    const rows = await h.pool.query<{ value: unknown }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM public."${table}" t`,
    );
    result[table] = rows.rows[0]?.value;
  }
  return result;
}

async function enumValues(h: TestDb): Promise<string[]> {
  const result = await h.pool.query<{ value: string }>(
    "SELECT e.enumlabel AS value FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='file_entity_type' ORDER BY e.enumsortorder",
  );
  return result.rows.map((row) => row.value);
}

async function seedCrmParents(h: TestDb, ownerId: string, messageId: string) {
  const { pipeline, stages } = await seedPipelineWithStages(h.db, ["Kept stage"]);
  const stage = stages[0];
  if (stage === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Upgrade stage fixture missing");
  const ids: Record<LegacyType, string> = {
    deal: randomUUID(),
    person: randomUUID(),
    organization: randomUUID(),
    activity: randomUUID(),
    email_message: messageId,
  };
  await h.pool.query(
    "INSERT INTO organizations (id,name,owner_id,visibility_level) VALUES ($1,'Retained organization',$2,'all')",
    [ids.organization, ownerId],
  );
  await h.pool.query(
    "INSERT INTO persons (id,name,owner_id,visibility_level,org_id) VALUES ($1,'Retained person',$2,'all',$3)",
    [ids.person, ownerId, ids.organization],
  );
  await h.pool.query(
    "INSERT INTO deals (id,title,pipeline_id,stage_id,owner_id,visibility_level,person_id,org_id) VALUES ($1,'Retained deal',$2,$3,$4,'all',$5,$6)",
    [ids.deal, pipeline.id, stage.id, ownerId, ids.person, ids.organization],
  );
  const typeId = randomUUID();
  await h.pool.query(
    "INSERT INTO activity_types (id,key,name) VALUES ($1,'mailbox-upgrade-type','Retained type')",
    [typeId],
  );
  await h.pool.query(
    "INSERT INTO activities (id,type_id,subject,owner_id,assignee_id,deal_id) VALUES ($1,$2,'Retained activity',$3,$3,$4)",
    [ids.activity, typeId, ownerId, ids.deal],
  );
  return ids;
}

async function insertFile(h: TestDb, ownerId: string, entityType: string, entityId: string) {
  const id = randomUUID();
  const filename = `retained-${entityType}.txt`;
  await h.pool.query(
    "INSERT INTO files (id,entity_type,entity_id,filename,s3_key,size_bytes,content_type,etag,status,uploaded_by) VALUES ($1,$2,$3,$4,$5,123,'text/plain','retained-etag','ready',$6)",
    [id, entityType, entityId, filename, `${entityType}/${entityId}/${id}-${filename}`, ownerId],
  );
  return { fileId: id, filename, size: 123 };
}

async function seedMail(h: TestDb, ownerId: string) {
  const accountId = randomUUID();
  const threadId = randomUUID();
  const messageId = randomUUID();
  await h.pool.query(
    "INSERT INTO email_accounts (id,user_id,email_address,provider,status,connection_generation,credential_version) VALUES ($1,$2,'mailbox-upgrade@example.test','imap_smtp','connected',7,3)",
    [accountId, ownerId],
  );
  await h.pool.query(
    "INSERT INTO email_threads (id,account_id,gmail_thread_id,subject,last_message_at,visibility) VALUES ($1,$2,'mailbox-upgrade-thread','Retained mail','2026-11-03 01:02:03.456789+00','private')",
    [threadId, accountId],
  );
  await h.pool.query(
    "INSERT INTO email_messages (id,thread_id,account_id,gmail_message_id,direction,from_email,to_emails,cc_emails,subject,body_html,sent_at) VALUES ($1,$2,$3,'mailbox-upgrade-message','inbound','sender@example.test','[\"mailbox-upgrade@example.test\"]','[\"cc@example.test\"]','Retained mail','<p>Retained message body</p>','2026-11-03 01:02:03.456789+00')",
    [messageId, threadId, accountId],
  );
  await h.pool.query(
    "INSERT INTO email_message_attachments (message_id,account_id,gmail_attachment_id,filename,mime_type,size_bytes) VALUES ($1,$2,'retained-inbound','inbound.txt','text/plain',5)",
    [messageId, accountId],
  );
  await h.pool.query(
    "INSERT INTO email_thread_reads (thread_id,user_id,read_at) VALUES ($1,$2,'2026-11-03 01:02:03.456789+00')",
    [threadId, ownerId],
  );
  return { accountId, threadId, messageId };
}

async function seedReceipt(h: TestDb, ownerId: string, accountId: string, threadId: string) {
  const operationId = randomUUID();
  const claim = randomUUID();
  await h.pool.query(
    "INSERT INTO email_read_intents (actor_id,operation_id,account_id,thread_id,mailbox_owner_id,account_provider,connection_generation,private_copy,desired_read,read_mode,created_at,admit_before) VALUES ($1,$2,$3,$4,$1,'imap_smtp',7,false,true,'local',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes')",
    [ownerId, operationId, accountId, threadId],
  );
  // Establish a valid pre-upgrade receipt through the existing 0103 DB guards.
  await h.pool.query(
    "UPDATE email_read_intents SET state='admitted',dispatch_claim=$3,admitted_at=clock_timestamp() WHERE actor_id=$1 AND operation_id=$2",
    [ownerId, operationId, claim],
  );
  await h.pool.query(
    "UPDATE email_read_intents SET state='applied',terminal_at=clock_timestamp() WHERE actor_id=$1 AND operation_id=$2",
    [ownerId, operationId],
  );
  return { operationId, claim };
}

async function seedPopulatedPrefix(h: TestDb) {
  const owner = await seedUser(h.db);
  const mail = await seedMail(h, owner.id);
  const parents = await seedCrmParents(h, owner.id, mail.messageId);
  const attachments: Awaited<ReturnType<typeof insertFile>>[] = [];
  for (const entityType of legacyTypes)
    attachments.push(await insertFile(h, owner.id, entityType, parents[entityType]));
  const sendIntentId = randomUUID();
  await h.pool.query(
    "INSERT INTO email_drafts (account_id,thread_id,subject,body_html,to_emails,cc_emails,bcc_emails,attachments,send_intent_id,visibility,track_opens,track_links) VALUES ($1,$2,'Retained draft','<p>Retained draft body</p>','[\"to@example.test\"]','[\"cc@example.test\"]','[\"bcc@example.test\"]',$3::jsonb,$4,'private',true,true)",
    [mail.accountId, mail.threadId, JSON.stringify(attachments), sendIntentId],
  );
  const receipt = await seedReceipt(h, owner.id, mail.accountId, mail.threadId);
  expect(
    (await h.pool.query("SELECT entity_type::text AS type FROM files ORDER BY entity_type")).rows,
  ).toEqual(legacyTypes.map((type) => ({ type })));
  expect(
    (
      await h.pool.query(
        "SELECT to_emails,cc_emails,bcc_emails,body_html,attachments,send_intent_id FROM email_drafts",
      )
    ).rows,
  ).toEqual([
    {
      to_emails: ["to@example.test"],
      cc_emails: ["cc@example.test"],
      bcc_emails: ["bcc@example.test"],
      body_html: "<p>Retained draft body</p>",
      attachments,
      send_intent_id: sendIntentId,
    },
  ]);
  expect(
    (await h.pool.query("SELECT operation_id,state,dispatch_claim FROM email_read_intents")).rows,
  ).toEqual([
    { operation_id: receipt.operationId, state: "applied", dispatch_claim: receipt.claim },
  ]);
  return { ownerId: owner.id, accountId: mail.accountId };
}

// Public migration admission owns the transaction. The new enum value is used
// only after that admission commits; this is DB metadata evidence, not object storage proof.
it("admits the populated 104-entry mailbox file upgrade once without changing legacy data", async () => {
  const h = await freshMigrationDb();
  let target: Awaited<ReturnType<typeof migrationFolder>> | undefined;
  try {
    target = await migrationFolder(105);
    await installPrefix(h, 104);
    expect(await enumValues(h)).toEqual(legacyTypes);
    const fixture = await seedPopulatedPrefix(h);
    await expect(
      insertFile(h, fixture.ownerId, "email_mailbox", fixture.accountId),
    ).rejects.toMatchObject({ code: "22P02" });
    const before = await retainedRows(h);
    const oldLedger = await ledger(h);
    expect(oldLedger).toHaveLength(104);
    expect(await applyMigrations(h.db, AbortSignal.timeout(15_000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await retainedRows(h)).toEqual(before);
    expect(await enumValues(h)).toEqual([...legacyTypes, "email_mailbox"]);
    const admittedLedger = await ledger(h);
    expect(admittedLedger).toHaveLength(105);
    expect(admittedLedger.slice(0, 104)).toEqual(oldLedger);
    const mailboxFile = await insertFile(h, fixture.ownerId, "email_mailbox", fixture.accountId);
    expect(
      (
        await h.pool.query(
          "SELECT entity_type::text AS type,entity_id,uploaded_by FROM files WHERE id=$1",
          [mailboxFile.fileId],
        )
      ).rows,
    ).toEqual([
      { type: "email_mailbox", entity_id: fixture.accountId, uploaded_by: fixture.ownerId },
    ]);
    const afterInsert = await retainedRows(h);
    expect(await applyMigrations(h.db, AbortSignal.timeout(15_000), target.folder)).toEqual({
      ok: true,
      value: { applied: true },
    });
    expect(await ledger(h)).toEqual(admittedLedger);
    expect(await enumValues(h)).toEqual([...legacyTypes, "email_mailbox"]);
    expect(await retainedRows(h)).toEqual(afterInsert);
  } finally {
    try {
      await target?.dispose();
    } finally {
      await h.close();
    }
  }
});
