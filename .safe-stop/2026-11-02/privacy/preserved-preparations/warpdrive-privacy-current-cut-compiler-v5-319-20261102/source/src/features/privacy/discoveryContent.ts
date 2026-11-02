import { type SQL, sql } from "drizzle-orm";
import { column, dealIds, leadIds, subjectAddresses } from "./discoveryAnchors";
import type { DiscoverySubject } from "./discoveryTypes";

export function noteIds(): SQL {
  return sql`SELECT id FROM privacy_discovery_notes`;
}
export function threadMatch(alias: string, subject: DiscoverySubject): SQL {
  const direct =
    subject.kind === "contact"
      ? sql`${column(alias, "person_id")}=${subject.referenceId}::uuid`
      : sql`false`;
  return sql`(${direct} OR ${column(alias, "deal_id")} IN (${dealIds()}) OR ${column(alias, "lead_id")} IN (${leadIds()}))`;
}
export function correspondence(alias: string, from: boolean): SQL {
  const sender = from
    ? sql`lower(trim(${column(alias, "from_email")}::text)) IN (${subjectAddresses()})`
    : sql`false`;
  return sql`(${sender} OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${column(alias, "to_emails")}) address WHERE lower(trim(address)) IN (${subjectAddresses()})) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${column(alias, "cc_emails")}) address WHERE lower(trim(address)) IN (${subjectAddresses()})))`;
}
export function linkedMessage(alias: string): SQL {
  return sql`EXISTS(SELECT 1 FROM privacy_discovery_threads t WHERE t.id=${column(alias, "thread_id")} AND t.account_id=${column(alias, "account_id")})`;
}
export function messageIds(): SQL {
  return sql`SELECT id FROM privacy_discovery_messages`;
}
export function draftMatch(alias: string, subject: DiscoverySubject): SQL {
  const person =
    subject.kind === "contact"
      ? sql`${column(alias, "link_person_id")}=${subject.referenceId}::uuid`
      : sql`false`;
  return sql`(${person} OR ${column(alias, "link_deal_id")} IN (${dealIds()}) OR ${linkedMessage(alias)} OR ${correspondence(alias, false)})`;
}
export function definitionMatch(subject: DiscoverySubject): SQL {
  const type = subject.kind === "contact" ? "person" : "user";
  const pairs = [
    ["deal", "deals"],
    ["lead", "leads"],
    ["person", "persons"],
    ["organization", "organizations"],
    ["activity", "activities"],
  ] as const;
  const references = pairs.map(
    ([entity, table]) =>
      sql`(cf.target_entity=${entity} AND EXISTS(SELECT 1 FROM ${sql.identifier(table)} record WHERE record.custom_fields->>cf.key=${subject.referenceId}))`,
  );
  return sql`(cf.type=${type} AND (${sql.join(references, sql` OR `)}))`;
}
