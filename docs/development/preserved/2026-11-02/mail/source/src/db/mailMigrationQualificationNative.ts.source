import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect } from "vitest";
import { env } from "@/config/env";
import { decryptToken, encryptToken } from "@/features/email/crypto";
import { getActorMailbox } from "@/features/email/mailboxOwnership";
import { imapMessageFingerprint } from "@/features/email/imapThreading";
import { getThread } from "@/features/email/emailReads";
import { checkMailboxInputSchema } from "@/features/email/mailConnectionSchemas";
import type { AuthUser } from "@/features/permissions/types";
import { QUALIFICATION_TOKEN, type QualificationIds } from "./mailMigrationQualificationFixtures";
import { assertQualificationNativeAuth } from "./mailMigrationQualificationAuth";
import { qualificationQuery as query, type QualificationDatabase } from "./mailMigrationQualification.test-helpers";
import { qualificationHash } from "./mailMigrationQualificationSource";

function wrongKeyRejected(token: Buffer): boolean {
  try {
    const wrong = createHash("sha256").update(Buffer.from(env.TOKEN_ENCRYPTION_KEY,"base64")).update("qualification-wrong-key").digest();
    const decipher = createDecipheriv("aes-256-gcm",wrong,token.subarray(0,12),{authTagLength:16});
    decipher.setAuthTag(token.subarray(12,28));
    decipher.update(token.subarray(28));decipher.final();return false;
  } catch { return true; }
}

export async function assertLegacyMailQualification(database: QualificationDatabase, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  const account = (await query<{ refresh_token_enc: Buffer; provider: string; is_default: boolean; connection_generation: number; scopes: string[] }>(database.pool, "SELECT refresh_token_enc,provider,is_default,connection_generation,scopes FROM email_accounts WHERE id=$1",[ids.account],signal)).rows[0];
  expect(account?.provider).toBe("gmail");expect(account?.is_default).toBe(true);expect(account?.connection_generation).toBe(1);
  expect(account?.scopes).toEqual(["gmail.modify","gmail.send"]);
  expect(account?.refresh_token_enc !== undefined).toBe(true);
  if (account?.refresh_token_enc !== undefined) {
    const decrypted = decryptToken(account.refresh_token_enc);
    expect(decrypted.ok).toBe(true);
    if(decrypted.ok) expect(qualificationHash(decrypted.value)).toBe(qualificationHash(QUALIFICATION_TOKEN));
    expect(wrongKeyRejected(account.refresh_token_enc)).toBe(true);
  }
  const other = (await query(database.pool,"SELECT provider,is_default,connection_generation,scopes FROM email_accounts WHERE id=$1",[ids.otherAccount],signal)).rows[0];
  expect(other).toEqual({provider:"gmail",is_default:true,connection_generation:1,scopes:["gmail.readonly"]});
  await assertQualificationNativeAuth(database,ids,signal);
  const identity = await query(database.pool, "SELECT id,provider_thread_id,gmail_thread_id FROM email_threads WHERE id=$1",[ids.privateThread],signal);
  expect(identity.rows).toEqual([{id:ids.privateThread,provider_thread_id:"gmail-private-thread",gmail_thread_id:"gmail-private-thread"}]);
  const message = await query(database.pool,"SELECT id,provider_message_id,gmail_message_id FROM email_messages WHERE id=$1",[ids.privateMessage],signal);
  expect(message.rows).toEqual([{id:ids.privateMessage,provider_message_id:"gmail-private-message",gmail_message_id:"gmail-private-message"}]);
  const attempt = await query(database.pool,"SELECT provider_message_id,connection_generation FROM email_send_attempts WHERE id=$1",[ids.attempt],signal);
  expect(attempt.rows).toEqual([{provider_message_id:"gmail-sent-stable",connection_generation:1}]);
  expect((await getActorMailbox(database.db,ids.owner,signal))?.id).toBe(ids.account);
  expect((await getActorMailbox(database.db,ids.viewer,signal))?.id).toBe(ids.otherAccount);
  const actor = (id: string, admin=false): AuthUser => ({id,type:admin?"admin":"regular",isActive:true,groupIds:new Set(id===ids.owner || id===ids.viewer ? [ids.group] : [])});
  expect((await getThread(database.db,{actor:actor(ids.owner),threadId:ids.privateThread,allowRemote:false},signal)).ok).toBe(true);
  expect((await getThread(database.db,{actor:actor(ids.admin,true),threadId:ids.privateThread,allowRemote:false},signal)).ok).toBe(false);
  expect((await getThread(database.db,{actor:actor(ids.viewer),threadId:ids.privateThread,allowRemote:false},signal)).ok).toBe(false);
  expect((await getThread(database.db,{actor:actor(ids.viewer),threadId:ids.sharedThread,allowRemote:false},signal)).ok).toBe(true);
  expect((await getThread(database.db,{actor:actor(ids.outsider),threadId:ids.sharedThread,allowRemote:false},signal)).ok).toBe(false);
  expect((await getThread(database.db,{actor:actor(ids.owner),threadId:ids.archivedThread,allowRemote:false},signal)).ok).toBe(true);
  expect((await getThread(database.db,{actor:actor(ids.owner),threadId:ids.trashedThread,allowRemote:false},signal)).ok).toBe(false);
  expect((await query(database.pool,"SELECT id,archived_at IS NOT NULL AS archived,trashed_at IS NOT NULL AS trashed FROM email_threads WHERE id IN ($1,$2) ORDER BY gmail_thread_id",[ids.archivedThread,ids.trashedThread],signal)).rows).toEqual([{id:ids.archivedThread,archived:true,trashed:false},{id:ids.trashedThread,archived:false,trashed:true}]);
}

const PROVIDER_CREDENTIALS = {
  emailAddress:"native@qualification.test",
  imap:{host:"imap.qualification.test",port:993,security:"tls",username:"native@qualification.test",password:"synthetic-qualification-only"},
  smtp:{host:"smtp.qualification.test",port:465,security:"tls",username:"native@qualification.test",password:"synthetic-qualification-only"},
};
export const QUALIFICATION_SOURCE_HASH = qualificationHash(Buffer.from("synthetic exact native source"));

export async function assertQualifiedProviderCredentials(database: QualificationDatabase, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  const row = (await query<{ credentials_enc: Buffer; connection_generation: number; credential_version: number }>(database.pool,"SELECT credentials_enc,connection_generation,credential_version FROM email_accounts WHERE id=$1",[ids.nativeAccount],signal)).rows[0];
  expect(row !== undefined).toBe(true);
  if (row !== undefined) {
    expect({generation:row.connection_generation,version:row.credential_version}).toEqual({generation:7,version:4});
    const decoded = decryptToken(row.credentials_enc);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const value: unknown = JSON.parse(decoded.value);
      const parsed = checkMailboxInputSchema.safeParse(value);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(qualificationHash(JSON.stringify(parsed.data))).toBe(qualificationHash(JSON.stringify(PROVIDER_CREDENTIALS)));
    }
    expect(wrongKeyRejected(row.credentials_enc)).toBe(true);
  }
}

export async function seedQualifiedProviderState(pool: Pool, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  await query(pool, `INSERT INTO email_accounts(id,user_id,email_address,provider,credentials_enc,connection_generation,credential_version,folder_paths)
    VALUES($1,$2,'native@qualification.test','imap_smtp',$3,7,4,'["INBOX"]')`,[ids.nativeAccount,ids.owner,encryptToken(JSON.stringify(PROVIDER_CREDENTIALS))],signal);
  await query(pool, "INSERT INTO email_threads(id,account_id,provider_thread_id,visibility) VALUES($1,$2,'imap:qualification','private')",[ids.nativeThread,ids.nativeAccount],signal);
  const fingerprint=imapMessageFingerprint(ids.nativeAccount,Buffer.from("synthetic exact native source"));
  await query(pool, "INSERT INTO email_messages(id,thread_id,account_id,provider_message_id,rfc_message_id,message_fingerprint,direction,from_email) VALUES($1,$2,$3,'imap:qualification-message','<synthetic@qualification.test>',$4,'inbound','client@qualification.test')",[ids.nativeMessage,ids.nativeThread,ids.nativeAccount,fingerprint],signal);
  await query(pool,"INSERT INTO mail_folders(id,account_id,path,uid_validity,last_uid,read_only) VALUES($1,$2,'INBOX','123',3,false)",[ids.nativeFolder,ids.nativeAccount],signal);
  const column=(await query(pool,"SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mail_message_locators' AND column_name='source_fingerprint'",[],signal)).rows.length === 1;
  for(const uid of [1,2,3]) await query(pool,`INSERT INTO mail_message_locators(id,account_id,folder_id,uid_validity,uid,message_id,active${column?",source_fingerprint":""}) VALUES($1,$2,$3,'123',$4,$5,$6${column?",$7":""})`,[uid===1?ids.nativeLocator:randomUUID(),ids.nativeAccount,ids.nativeFolder,uid,ids.nativeMessage,uid!==2,...(column?[uid===3?null:QUALIFICATION_SOURCE_HASH]:[])],signal);
  await query(pool,"INSERT INTO email_message_attachments(message_id,account_id,filename,mime_type,size_bytes,provider_locator) VALUES($1,$2,'private.pdf','application/pdf',8,$3::jsonb)",[ids.nativeMessage,ids.nativeAccount,JSON.stringify({kind:"stored",objectKey:"qualification/private-synthetic-pdf",sha256:qualificationHash(Buffer.from("%PDF-1.7"))})],signal);
  for(const state of ["accepted","partial","unknown"]) {
    const id=randomUUID();
    const receipt={state,accepted:state==="unknown"?[]:["client@qualification.test"],rejected:state==="partial"?["rejected@qualification.test"]:[],semanticFingerprint:qualificationHash(state),preparedAttachments:[{objectKey:"qualification/private-synthetic-pdf",sha256:qualificationHash(Buffer.from("%PDF-1.7")),size:8,ready:true}]};
    await query(pool,`INSERT INTO email_send_attempts(id,idempotency_key,message_id_header,account_id,thread_id,payload,status,connection_generation,delivery_outcome,send_started_at)
      VALUES($1,$2,$3,$4,$5,'{"to":["client@qualification.test"],"html":"<p>synthetic</p>"}',$6,7,$7::jsonb,'2026-10-30')`,[id,randomUUID(),`<${id}@qualification.test>`,ids.nativeAccount,ids.nativeThread,state==="unknown"?"needs_review":"sent",JSON.stringify(receipt)],signal);
  }
}
