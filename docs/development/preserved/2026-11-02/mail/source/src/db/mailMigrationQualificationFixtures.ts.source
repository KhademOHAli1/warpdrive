import { randomUUID } from "node:crypto";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import type { Pool } from "pg";
import { env } from "@/config/env";
import { createHashedBackupCodeStorage } from "@/features/auth/better/recoveryCodes";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { encryptToken } from "@/features/email/crypto";
import { qualificationQuery as query } from "./mailMigrationQualification.test-helpers";

export const QUALIFICATION_PASSWORD = "Synthetic-qualification-password-for-local-fixtures";
export const QUALIFICATION_TOKEN = "synthetic-gmail-refresh-token-not-a-provider-credential";
export const QUALIFICATION_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
export const QUALIFICATION_RECOVERY_CODES = ["qualification-only-recovery-code"];
const ID_KEYS = ["owner", "viewer", "admin", "outsider", "invited", "inactive", "group", "permission", "org", "person", "pipeline", "stage", "deal", "account", "otherAccount", "privateThread", "sharedThread", "privateMessage", "sharedMessage", "attachment", "draft", "attempt", "tracking", "event", "session", "strongSession", "revokedSession", "twoFactor", "archivedThread", "trashedThread", "authAccount", "workflow", "version", "run", "step", "secondWorkflow", "secondVersion", "request", "nativeAccount", "nativeThread", "nativeMessage", "nativeFolder", "nativeLocator"] as const;
export type QualificationIds = Record<typeof ID_KEYS[number], string>;
export function qualificationIds(): QualificationIds {
  return Object.fromEntries(ID_KEYS.map((key) => [key, randomUUID()])) as QualificationIds;
}
export function qualificationSessionCredential(id: string): string {
  return `qualification_session_${id.replaceAll("-", "")}`;
}

export async function seedMailMigrationBaseline(pool: Pool, signal: AbortSignal) {
  const ids = qualificationIds();
  const token = encryptToken(QUALIFICATION_TOKEN);
  const password = await hashPassword(QUALIFICATION_PASSWORD);
  signal.throwIfAborted();
  const totp = await symmetricEncrypt({ key: env.AUTH_SECRET || env.TOKEN_ENCRYPTION_KEY, data: QUALIFICATION_TOTP_SECRET });
  signal.throwIfAborted();
  const recovery = await createHashedBackupCodeStorage().encrypt(JSON.stringify(QUALIFICATION_RECOVERY_CODES));
  signal.throwIfAborted();
  await query(pool, "INSERT INTO permission_sets(id,name,flags) VALUES($1,'Qualification','{}'::jsonb)", [ids.permission], signal);
  await query(pool, "INSERT INTO visibility_groups(id,name) VALUES($1,'Qualification group')", [ids.group], signal);
  for (const key of ["owner", "viewer", "admin", "outsider", "invited", "inactive"] as const)
    await query(pool, `INSERT INTO users(id,email,name,is_admin,is_active,permission_set_id,primary_visibility_group_id,invited_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [ids[key], `${key}@qualification.test`, key, key === "admin", key !== "inactive", ids.permission, ids.group, key === "invited" ? "2026-10-30T10:11:12Z" : null], signal);
  await query(pool, "INSERT INTO visibility_group_members(group_id,user_id) VALUES($1,$2),($1,$3)", [ids.group, ids.owner, ids.viewer], signal);
  await query(pool, `INSERT INTO auth_users(id,email,name,email_verified,two_factor_enabled) VALUES($1,'owner@qualification.test','Owner',true,true)`, [ids.owner], signal);
  // user_id is UUID and account_id is text; do not infer both from one placeholder.
  await query(pool, "INSERT INTO auth_accounts(id,user_id,account_id,provider_id,password,scope) VALUES($1,$2,$3,'credential',$4,'native')", [ids.authAccount, ids.owner, ids.owner, password], signal);
  await query(pool, "INSERT INTO auth_two_factors(id,user_id,secret,backup_codes,verified) VALUES($1,$2,$3,$4,true)", [ids.twoFactor,ids.owner,totp,recovery], signal);
  await query(pool, `INSERT INTO sessions(id,token_hash,user_id,expires_at,auth_method,assurance,fresh_authenticated_at)
    VALUES($1,$2,$3,'2099-01-01','password','password','2026-10-30T10:11:12.123456Z')`, [ids.session, hashSessionCredential(qualificationSessionCredential(ids.session)), ids.owner], signal);
  await query(pool, `INSERT INTO sessions(id,token_hash,user_id,expires_at,auth_method,assurance,mfa_verified_at,fresh_authenticated_at,revoked_at)
    VALUES($1,$2,$3,'2099-01-01','password','mfa','2026-10-30T10:11:12.123456Z','2026-10-30T10:11:12.123456Z',NULL),
      ($4,$5,$3,'2099-01-01','password','mfa','2026-10-30T10:11:12.123456Z','2026-10-30T10:11:12.123456Z','2026-10-30T11:00Z')`,
    [ids.strongSession,hashSessionCredential(qualificationSessionCredential(ids.strongSession)),ids.owner,ids.revokedSession,hashSessionCredential(qualificationSessionCredential(ids.revokedSession))],signal);
  await query(pool, `INSERT INTO user_preferences(user_id,timezone,ui) VALUES($1,'Asia/Tehran',$2::jsonb),($3,'Europe/Berlin',$4::jsonb)`, [ids.owner, JSON.stringify({ localePreferences: { locale: "fa", calendar: "persian", timeZone: "Asia/Tehran", numberingSystem: "arabext", iranianMoneyUnit: "toman" } }), ids.viewer, JSON.stringify({ localePreferences: { locale: "de", calendar: "gregory", timeZone: "Europe/Berlin", numberingSystem: "latn" } })], signal);
  await query(pool, "INSERT INTO organizations(id,name,owner_id,visibility_level) VALUES($1,'Qualification GmbH',$2,'owner')", [ids.org, ids.owner], signal);
  await query(pool, `INSERT INTO persons(id,name,owner_id,org_id,visibility_level,visible_to_user_ids,emails)
    VALUES($1,'مشتری / Kundin',$2,$3,'owner',ARRAY[$4]::uuid[],'[{"label":"work","value":"client@qualification.test"}]')`, [ids.person, ids.owner, ids.org, ids.viewer], signal);
  await query(pool, "INSERT INTO pipelines(id,name) VALUES($1,'Qualification pipeline')", [ids.pipeline], signal);
  await query(pool, 'INSERT INTO stages(id,pipeline_id,name,"order") VALUES($1,$2,\'Qualification stage\',0)', [ids.stage, ids.pipeline], signal);
  await query(pool, `INSERT INTO deals(id,title,pipeline_id,stage_id,owner_id,person_id,org_id,visibility_level,visible_to_user_ids,value,currency)
    VALUES($1,'پیشنهاد / Angebot',$2,$3,$4,$5,$6,'owner',ARRAY[$7]::uuid[],123.45,'EUR')`, [ids.deal, ids.pipeline, ids.stage, ids.owner, ids.person, ids.org, ids.viewer], signal);
  await query(pool, `INSERT INTO email_accounts(id,user_id,email_address,refresh_token_enc,scopes,last_history_id,watch_expires_at)
    VALUES($1,$2,'legacy@gmail.test',$3,'["gmail.modify","gmail.send"]','12345678901234567890','2027-01-01'),($4,$5,'second@gmail.test',$3,'["gmail.readonly"]','7','2027-01-01')`, [ids.account, ids.owner, token, ids.otherAccount, ids.viewer], signal);
  await query(pool, `INSERT INTO email_threads(id,account_id,gmail_thread_id,subject,person_id,deal_id,visibility,last_message_at)
    VALUES($1,$2,'gmail-private-thread','خصوصی / Privat',$3,$4,'private','2026-10-30'),($5,$2,'gmail-shared-thread','مشترک / Freigegeben',$3,$4,'shared','2026-10-30')`, [ids.privateThread, ids.account, ids.person, ids.deal, ids.sharedThread], signal);
  await query(pool, `INSERT INTO email_threads(id,account_id,gmail_thread_id,visibility,archived_at,trashed_at)
    VALUES($1,$2,'gmail-archived-thread','private','2026-10-30',NULL),
      ($3,$2,'gmail-trashed-thread','private',NULL,'2026-10-30')`, [ids.archivedThread,ids.account,ids.trashedThread],signal);
  await query(pool, `INSERT INTO email_messages(id,thread_id,account_id,gmail_message_id,direction,from_email,to_emails,subject,body_text,body_html,sent_at)
    VALUES($1,$2,$3,'gmail-private-message','inbound','client@qualification.test','["legacy@gmail.test"]','خصوصی / Privat','متن خصوصی / Privater Text','<p>متن خصوصی / Privater Text</p>','2026-10-30'),
      ($4,$5,$3,'gmail-shared-message','outbound','legacy@gmail.test','["client@qualification.test"]','مشترک / Freigegeben','سپاس / Vielen Dank','<p>سپاس / Vielen Dank</p>','2026-10-30')`, [ids.privateMessage, ids.privateThread, ids.account, ids.sharedMessage, ids.sharedThread], signal);
  await query(pool, `INSERT INTO email_message_attachments(id,message_id,account_id,gmail_attachment_id,filename,mime_type,size_bytes)
    VALUES($1,$2,$3,'gmail-attachment-stable','پیشنهاد.pdf','application/pdf',8)`, [ids.attachment, ids.privateMessage, ids.account], signal);
  await query(pool, `INSERT INTO email_drafts(id,account_id,thread_id,subject,body_html,to_emails,cc_emails,visibility,link_deal_id,link_person_id)
    VALUES($1,$2,$3,'پیش‌نویس / Entwurf','<p>Entwurf</p>','["client@qualification.test"]','["copy@qualification.test"]','private',$4,$5)`, [ids.draft, ids.account, ids.privateThread, ids.deal, ids.person], signal);
  await query(pool, `INSERT INTO email_send_attempts(id,idempotency_key,message_id_header,account_id,thread_id,payload,status,gmail_message_id,claimed_at,send_started_at,sent_at)
    VALUES($1,$2,$3,$4,$5,'{"to":["client@qualification.test"],"html":"<p>Vielen Dank</p>"}','sent','gmail-sent-stable','2026-10-30','2026-10-30','2026-10-30')`, [ids.attempt, randomUUID(), `<${ids.attempt}@qualification.test>`, ids.account, ids.sharedThread], signal);
  await query(pool, `INSERT INTO email_tracking_tokens(id,token,send_attempt_id,message_id,recipient,kind) VALUES($1,$2,$3,$4,'client@qualification.test','open')`, [ids.tracking, `synthetic-tracking-${ids.tracking}`, ids.attempt, ids.sharedMessage], signal);
  await query(pool, `INSERT INTO email_tracking_events(id,token_id,message_id,event_type,recipient,occurred_at) VALUES($1,$2,$3,'open','client@qualification.test','2026-10-30')`, [ids.event, ids.tracking, ids.sharedMessage], signal);
  return { ids };
}

export async function seedMailMigrationPlatform(pool: Pool, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  const definition = JSON.stringify({ version: 1, nodes: [{ id: "start", type: "trigger.manual", version: 1, name: "شروع / Start", config: {} }], edges: [] });
  await query(pool, `INSERT INTO integration_connections(id,provider,account_id,account_name,owner_id,credentials,settings)
    VALUES($1,'slack','synthetic-workspace','Qualification',$2,$3,'{"channelId":"synthetic-channel"}')`, [randomUUID(), ids.owner, encryptToken("synthetic-integration-token")], signal);
  for (const [workflow, version, title] of [[ids.workflow, ids.version, "Qualification"], [ids.secondWorkflow, ids.secondVersion, "Other workflow"]]) {
    await query(pool, "INSERT INTO workflows(id,owner_id,name,draft) VALUES($1,$2,$3,$4::jsonb)", [workflow, ids.owner, title, definition], signal);
    await query(pool, "INSERT INTO workflow_versions(id,workflow_id,number,name,definition,published_by) VALUES($1,$2,1,$3,$4::jsonb,$5)", [version, workflow, title, definition, ids.owner], signal);
    await query(pool, "UPDATE workflows SET published_number=1,active=true WHERE id=$1", [workflow], signal);
  }
  await query(pool, `INSERT INTO workflow_runs(id,workflow_id,version_id,actor_id,request_key,mode,status,trigger,outputs)
    VALUES($1,$2,$3,$4,$5,'simulation','succeeded','{"recordId":"synthetic"}','{"start":{"ok":true}}')`, [ids.run, ids.workflow, ids.version, ids.owner, ids.request], signal);
  await query(pool, "INSERT INTO workflow_steps(id,run_id,node_id,simulated,output) VALUES($1,$2,'start',true,'{\"ok\":true}')", [ids.step, ids.run], signal);
}

export type MailMigrationFixture = Awaited<ReturnType<typeof seedMailMigrationBaseline>>;
