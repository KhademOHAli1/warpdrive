import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { expect } from "vitest";
import type { QualificationIds } from "./mailMigrationQualificationFixtures";
import { qualificationQuery as query } from "./mailMigrationQualification.test-helpers";

export async function assertQualificationWorkflowGuards(pool: Pool, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  const constraints=await query<{conname:string}>(pool,"SELECT conname FROM pg_constraint WHERE conname IN ('workflow_run_pinned_version_fk','workflows_published_version_fk') ORDER BY conname",[],signal);
  expect(constraints.rows.map((row)=>row.conname)).toEqual(["workflow_run_pinned_version_fk","workflows_published_version_fk"]);
  const trigger=await query(pool,"SELECT 1 FROM pg_trigger WHERE tgname='workflow_versions_immutable' AND tgenabled='O' AND NOT tgisinternal",[],signal);
  expect(trigger.rows).toHaveLength(1);
  const fn=await query(pool,"SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='workflow_version_immutable'",[],signal);
  expect(fn.rows).toHaveLength(1);
  await expect(query(pool,"UPDATE workflow_versions SET name='forbidden' WHERE id=$1",[ids.version],signal)).rejects.toMatchObject({code:"55000"});
  await expect(query(pool,"DELETE FROM workflow_versions WHERE id=$1",[ids.version],signal)).rejects.toMatchObject({code:"55000"});
  await expect(query(pool,"UPDATE workflows SET published_number=999 WHERE id=$1",[ids.workflow],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,`INSERT INTO workflow_runs(id,workflow_id,version_id,actor_id,request_key,mode,trigger)
    VALUES($1,$2,$3,$4,$5,'simulation','{}')`,[randomUUID(),ids.workflow,ids.secondVersion,ids.owner,randomUUID()],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,`INSERT INTO workflow_runs(id,workflow_id,version_id,actor_id,request_key,mode,trigger)
    VALUES($1,$2,$3,$4,$5,'simulation','{}')`,[randomUUID(),ids.workflow,ids.version,ids.owner,ids.request],signal)).rejects.toMatchObject({code:"23505"});
  await expect(query(pool,"INSERT INTO workflow_steps(run_id,node_id,simulated,output) VALUES($1,'start',true,'{}')",[ids.run],signal)).rejects.toMatchObject({code:"23505"});
  const version=await query(pool,"SELECT version_id,workflow_id FROM workflow_runs WHERE id=$1",[ids.run],signal);
  expect(version.rows).toEqual([{version_id:ids.version,workflow_id:ids.workflow}]);
}

export async function assertQualificationMailGuards(pool: Pool, ids: QualificationIds, signal: AbortSignal): Promise<void> {
  await expect(query(pool,"INSERT INTO email_messages(thread_id,account_id,provider_message_id,direction,from_email) VALUES($1,$2,$3,'inbound','synthetic@qualification.test')",[ids.privateThread,ids.nativeAccount,randomUUID()],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,"INSERT INTO email_drafts(account_id,thread_id) VALUES($1,$2)",[ids.nativeAccount,ids.privateThread],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,"INSERT INTO email_send_attempts(idempotency_key,message_id_header,account_id,thread_id,payload) VALUES($1,$2,$3,$4,'{}')",[randomUUID(),`<${randomUUID()}@qualification.test>`,ids.nativeAccount,ids.privateThread],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,"INSERT INTO mail_message_locators(account_id,folder_id,uid_validity,uid,message_id) VALUES($1,$2,'123',4,$3)",[ids.nativeAccount,ids.nativeFolder,ids.privateMessage],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,"INSERT INTO mail_message_locators(account_id,folder_id,uid_validity,uid,message_id) VALUES($1,$2,'123',5,$3)",[ids.account,ids.nativeFolder,ids.privateMessage],signal)).rejects.toMatchObject({code:"23503"});
  await expect(query(pool,"UPDATE email_accounts SET is_default=true WHERE id=$1",[ids.nativeAccount],signal)).rejects.toMatchObject({code:"23505"});
  const identity=await query(pool,"SELECT connection_generation,credential_version,is_default FROM email_accounts WHERE id=$1",[ids.nativeAccount],signal);
  expect(identity.rows).toEqual([{connection_generation:7,credential_version:4,is_default:false}]);
  const outcomes=await query(pool,"SELECT status,delivery_outcome->>'state' AS state FROM email_send_attempts WHERE account_id=$1 ORDER BY delivery_outcome->>'state'",[ids.nativeAccount],signal);
  expect(outcomes.rows).toEqual([{status:"sent",state:"accepted"},{status:"sent",state:"partial"},{status:"needs_review",state:"unknown"}]);
}
