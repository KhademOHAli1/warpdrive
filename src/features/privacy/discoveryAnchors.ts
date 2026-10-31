import { type SQL, sql } from "drizzle-orm";
import type { DiscoverySubject } from "./discoveryTypes";

export const column = (alias: string, name: string) =>
  sql`${sql.identifier(alias)}.${sql.identifier(name)}`;
export function customReference(alias: string, entity: string, subject: DiscoverySubject): SQL {
  const type = subject.kind === "contact" ? "person" : "user";
  return sql`EXISTS(SELECT 1 FROM custom_field_defs cf WHERE cf.target_entity=${entity} AND cf.type=${type} AND ${column(alias, "custom_fields")}->>cf.key=${subject.referenceId})`;
}
export function discoveryAddressQuery(subject: DiscoverySubject): SQL {
  if (subject.kind === "user")
    return sql`SELECT lower(trim(email::text)) AS address FROM users WHERE id=${subject.referenceId}::uuid`;
  return sql`SELECT lower(trim(value)) AS address FROM (
    SELECT primary_email::text AS value FROM persons WHERE id=${subject.referenceId}::uuid
    UNION SELECT point->>'value' FROM persons anchor CROSS JOIN LATERAL jsonb_array_elements(anchor.emails) point WHERE anchor.id=${subject.referenceId}::uuid
  ) addresses WHERE value IS NOT NULL AND trim(value)<>''`;
}
export function subjectAddresses(): SQL {
  return sql`SELECT address FROM privacy_discovery_addresses`;
}
export function sharedContactAddress(alias: string, subject: DiscoverySubject): SQL {
  if (subject.kind !== "contact") return sql`false`;
  return sql`(${column(alias, "id")}<>${subject.referenceId}::uuid AND (
    lower(trim(${column(alias, "primary_email")}::text)) IN (${subjectAddresses()}) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(${column(alias, "emails")}) point WHERE lower(trim(point->>'value')) IN (${subjectAddresses()})
    )
  ))`;
}
export function dealMatch(alias: string, subject: DiscoverySubject): SQL {
  const custom = customReference(alias, "deal", subject);
  if (subject.kind !== "contact") return custom;
  return sql`(${column(alias, "person_id")}=${subject.referenceId}::uuid OR EXISTS(SELECT 1 FROM deal_participants dp WHERE dp.deal_id=${column(alias, "id")} AND dp.person_id=${subject.referenceId}::uuid) OR EXISTS(SELECT 1 FROM leads converted WHERE converted.person_id=${subject.referenceId}::uuid AND converted.converted_deal_id=${column(alias, "id")}) OR ${custom})`;
}
export function dealIds(): SQL {
  return sql`SELECT id FROM privacy_discovery_deals`;
}
export function leadMatch(alias: string, subject: DiscoverySubject): SQL {
  return subject.kind === "contact"
    ? sql`(${column(alias, "person_id")}=${subject.referenceId}::uuid OR ${customReference(alias, "lead", subject)})`
    : customReference(alias, "lead", subject);
}
export function leadIds(): SQL {
  return sql`SELECT id FROM privacy_discovery_leads`;
}
export function activityMatch(alias: string, subject: DiscoverySubject): SQL {
  const explicit =
    subject.kind === "contact"
      ? sql`(${column(alias, "person_id")}=${subject.referenceId}::uuid OR EXISTS(SELECT 1 FROM activity_guests ag WHERE ag.activity_id=${column(alias, "id")} AND ag.person_id=${subject.referenceId}::uuid))`
      : sql`EXISTS(SELECT 1 FROM activity_participants ap WHERE ap.activity_id=${column(alias, "id")} AND ap.user_id=${subject.referenceId}::uuid)`;
  return sql`(${explicit} OR ${column(alias, "deal_id")} IN (${dealIds()}) OR ${column(alias, "lead_id")} IN (${leadIds()}) OR ${customReference(alias, "activity", subject)})`;
}
export function activityIds(): SQL {
  return sql`SELECT id FROM privacy_discovery_activities`;
}
export function entityMatch(alias: string, subject: DiscoverySubject): SQL {
  const entityType = sql`${column(alias, "entity_type")}::text`;
  const direct =
    subject.kind === "contact"
      ? sql`(${entityType}='person' AND ${column(alias, "entity_id")}=${subject.referenceId}::uuid)`
      : sql`false`;
  return sql`(${direct} OR (${entityType}='deal' AND ${column(alias, "entity_id")} IN (${dealIds()})) OR (${entityType}='lead' AND ${column(alias, "entity_id")} IN (${leadIds()})) OR (${entityType}='activity' AND ${column(alias, "entity_id")} IN (${activityIds()})))`;
}
