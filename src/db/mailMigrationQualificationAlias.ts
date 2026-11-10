import type { Pool } from "pg";
import { expect } from "vitest";
import { seedMailMigrationBaseline, seedMailMigrationPlatform, type QualificationIds } from "./mailMigrationQualificationFixtures";
import { assertLegacyMailQualification, assertQualifiedProviderCredentials, QUALIFICATION_SOURCE_HASH, seedQualifiedProviderState } from "./mailMigrationQualificationNative";
import { assertQualificationBaselineGuards, assertQualificationJournal, captureQualificationGuardSet, captureQualificationRows } from "./mailMigrationQualificationSnapshot";
import { qualificationMigrate, qualificationQuery as query, type MailMigrationQualificationHarness } from "./mailMigrationQualification.test-helpers";

export async function assertQualificationAliasIndex(pool: Pool, signal: AbortSignal): Promise<void> {
  const indexes = await query<{ unique_index: boolean; columns: string[]; predicate: string | null }>(pool, `SELECT i.indisunique AS unique_index,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ordinal)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE k.ordinal<=i.indnkeyatts ORDER BY k.ordinal) AS columns,
    pg_get_expr(i.indpred,i.indrelid) AS predicate
    FROM pg_index i WHERE i.indrelid='public.mail_message_locators'::regclass AND i.indisvalid AND i.indisready`,[],signal);
  // Inactive observations remain useful after MOVE. An active-only partial index is insufficient.
  expect(indexes.rows.some((row) => !row.unique_index && row.columns[0] === "account_id" && row.columns[1] === "source_fingerprint" &&
    (row.predicate === null || /^\(?source_fingerprint IS NOT NULL\)?$/.test(row.predicate.replaceAll('"',''))))).toBe(true);
}

export async function assertQualificationAliases(pool: Pool, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  const column = await query(pool,"SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mail_message_locators' AND column_name='source_fingerprint'",[],signal);
  expect(column.rows).toHaveLength(1);
  await assertQualificationAliasIndex(pool,signal);
  const aliases = await query(pool,"SELECT source_fingerprint IS NULL AS unknown,count(*)::int AS copies FROM mail_message_locators WHERE account_id=$1 GROUP BY source_fingerprint IS NULL ORDER BY unknown",[ids.nativeAccount],signal);
  expect(aliases.rows).toEqual([{unknown:false,copies:2},{unknown:true,copies:1}]);
}

export async function assertQualification90Upgrade(h: MailMigrationQualificationHarness, signal: AbortSignal): Promise<void> {
  const database = await h.database(signal);
  await h.prefix(database,90,signal);
  const fixture = await seedMailMigrationBaseline(database.pool,signal);
  // A90 fixture starts after the historical backfills; represent the already migrated state.
  await query(database.pool,"UPDATE email_accounts SET is_default=true WHERE id IN ($1,$2)",[fixture.ids.account,fixture.ids.otherAccount],signal);
  await query(database.pool,"UPDATE email_threads SET provider_thread_id=gmail_thread_id WHERE account_id IN ($1,$2)",[fixture.ids.account,fixture.ids.otherAccount],signal);
  await query(database.pool,"UPDATE email_messages SET provider_message_id=gmail_message_id WHERE account_id IN ($1,$2)",[fixture.ids.account,fixture.ids.otherAccount],signal);
  await query(database.pool,"UPDATE email_send_attempts s SET provider_message_id=s.gmail_message_id,connection_generation=a.connection_generation FROM email_accounts a WHERE a.id=s.account_id AND a.id IN ($1,$2)",[fixture.ids.account,fixture.ids.otherAccount],signal);
  await seedMailMigrationPlatform(database.pool,fixture.ids,signal);
  expect((await query(database.pool,"SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mail_message_locators' AND column_name='source_fingerprint'",[],signal)).rows).toHaveLength(0);
  await seedQualifiedProviderState(database.pool,fixture.ids,signal);
  const historical = await captureQualificationRows(database.pool,signal);
  const guards = await captureQualificationGuardSet(database.pool,signal);
  const locatorQuery = "SELECT id,account_id,folder_id,uid_validity,uid::text,message_id,active,flags FROM mail_message_locators WHERE account_id=$1 ORDER BY uid";
  const identities = (await query(database.pool,locatorQuery,[fixture.ids.nativeAccount],signal)).rows;
  expect(identities).toHaveLength(3);
  await qualificationMigrate(database,h.sources.folder,signal);
  await assertQualificationJournal(database.pool,h.sources,signal);
  expect(await captureQualificationRows(database.pool,signal,historical)).toEqual(historical);
  assertQualificationBaselineGuards(guards,await captureQualificationGuardSet(database.pool,signal));
  expect((await query(database.pool,locatorQuery,[fixture.ids.nativeAccount],signal)).rows).toEqual(identities);
  // No historical raw-byte proof exists, even though the message has a separate fingerprint.
  expect((await query(database.pool,"SELECT source_fingerprint FROM mail_message_locators WHERE account_id=$1 ORDER BY uid",[fixture.ids.nativeAccount],signal)).rows).toEqual([{source_fingerprint:null},{source_fingerprint:null},{source_fingerprint:null}]);
  await assertQualificationAliasIndex(database.pool,signal);
  // Actual writes prove repeated account/hash values, including an inactive alias, are admitted.
  await query(database.pool,"UPDATE mail_message_locators SET source_fingerprint=$2 WHERE account_id=$1 AND uid IN (1,2)",[fixture.ids.nativeAccount,QUALIFICATION_SOURCE_HASH],signal);
  await assertQualificationAliases(database.pool,fixture.ids,signal);
  await assertLegacyMailQualification(database,fixture.ids,signal);
  await assertQualifiedProviderCredentials(database,fixture.ids,signal);
  const before = await captureQualificationRows(database.pool,signal);
  await qualificationMigrate(database,h.sources.folder,signal);
  expect(await captureQualificationRows(database.pool,signal)).toEqual(before);
  await assertQualificationJournal(database.pool,h.sources,signal);
}
