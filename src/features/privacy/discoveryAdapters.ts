import { type SQL, sql } from "drizzle-orm";
import {
  activityMatch,
  column,
  customReference,
  dealMatch,
  entityMatch,
  leadMatch,
  sharedContactAddress,
} from "./discoveryAnchors";
import {
  correspondence,
  definitionMatch,
  draftMatch,
  linkedMessage,
  messageIds,
  noteIds,
  threadMatch,
} from "./discoveryContent";
import type { DiscoveryAdapter, DiscoverySubject } from "./discoveryTypes";

function query(
  table: string,
  alias: string,
  where: SQL,
  relation: SQL = sql`'subject_relationship'`,
  confidence: SQL = sql`'linked'`,
  id: SQL = column(alias, "id"),
): SQL {
  return sql`SELECT ${id}::text AS id,${relation}::text AS relation,${confidence}::text AS confidence FROM ${sql.identifier(table)} ${sql.identifier(alias)} WHERE ${where}`;
}
const exact = (alias: string, subject: DiscoverySubject) =>
  sql`${column(alias, "id")}=${subject.referenceId}::uuid`;
const contact = (subject: DiscoverySubject, condition: SQL) =>
  subject.kind === "contact" ? condition : sql`false`;
const user = (subject: DiscoverySubject, condition: SQL) =>
  subject.kind === "user" ? condition : sql`false`;

export const discoveryAdapters: readonly DiscoveryAdapter[] = [
  {
    store: "activities",
    source:
      "activities.person_id/deal_id/lead_id/custom_fields; activity_guests; activity_participants",
    query: (s) => query("activities", "a", activityMatch("a", s)),
  },
  {
    store: "activity_guests",
    source: "activity_guests.person_id",
    query: (s) =>
      query(
        "activity_guests",
        "ag",
        contact(s, sql`ag.person_id=${s.referenceId}::uuid`),
        sql`'explicit_guest'`,
        sql`'exact'`,
        sql`ag.activity_id::text||':'||ag.person_id::text`,
      ),
  },
  {
    store: "activity_participants",
    source: "activity_participants.user_id",
    query: (s) =>
      query(
        "activity_participants",
        "ap",
        user(s, sql`ap.user_id=${s.referenceId}::uuid`),
        sql`'explicit_participant'`,
        sql`'exact'`,
        sql`ap.activity_id::text||':'||ap.user_id::text`,
      ),
  },
  {
    store: "auth_users",
    source: "auth_users.id -> users.id",
    query: (s) =>
      query("auth_users", "au", user(s, exact("au", s)), sql`'account_identity'`, sql`'exact'`),
  },
  {
    store: "change_logs",
    source: "change_logs.entity_type/entity_id (including historical values)",
    query: (s) => query("change_logs", "cl", entityMatch("cl", s), sql`'linked_entity_history'`),
  },
  {
    store: "comments",
    source: "comments.note_id -> notes.entity_type/entity_id",
    query: () => query("comments", "c", sql`c.note_id IN (${noteIds()})`, sql`'linked_note'`),
  },
  {
    store: "custom_field_defs",
    source: "custom_field_defs.target_entity/type/key -> exact custom_fields reference",
    query: (s) =>
      query("custom_field_defs", "cf", definitionMatch(s), sql`'typed_reference_definition'`),
  },
  {
    store: "deal_participants",
    source: "deal_participants.person_id",
    query: (s) =>
      query(
        "deal_participants",
        "dp",
        contact(s, sql`dp.person_id=${s.referenceId}::uuid`),
        sql`'explicit_participant'`,
        sql`'exact'`,
        sql`dp.deal_id::text||':'||dp.person_id::text`,
      ),
  },
  {
    store: "deals",
    source:
      "deals.person_id; deal_participants.person_id; leads.converted_deal_id; typed custom_fields",
    query: (s) =>
      query(
        "deals",
        "d",
        dealMatch("d", s),
        sql`CASE WHEN ${customReference("d", "deal", s)} THEN 'reverse_custom_reference' ELSE 'subject_relationship' END`,
      ),
  },
  {
    store: "email_drafts",
    source:
      "email_drafts.link_person_id/link_deal_id/thread_id/account_id/to_emails/cc_emails/bcc_emails",
    query: (s) =>
      query(
        "email_drafts",
        "dr",
        draftMatch("dr", s),
        sql`'draft_context_or_correspondence'`,
        sql`'ambiguous'`,
      ),
  },
  {
    store: "email_messages",
    source: "email_messages.thread_id/account_id/from_email/to_emails/cc_emails",
    query: () =>
      query(
        "email_messages",
        "m",
        sql`(${linkedMessage("m")} OR ${correspondence("m", true)})`,
        sql`CASE WHEN ${linkedMessage("m")} THEN 'linked_thread' ELSE 'correspondence_only' END`,
        sql`CASE WHEN ${linkedMessage("m")} THEN 'linked' ELSE 'ambiguous' END`,
      ),
  },
  {
    store: "email_threads",
    source: "email_threads.person_id/deal_id/lead_id (no account-owner sweep)",
    query: (s) => query("email_threads", "t", threadMatch("t", s), sql`'explicit_crm_link'`),
  },
  {
    store: "files",
    source: "files.entity_type/entity_id; object contents are not inspected",
    query: (s) =>
      query(
        "files",
        "f",
        sql`(${entityMatch("f", s)} OR (f.entity_type='email_message' AND f.entity_id IN (${messageIds()})))`,
        sql`'linked_entity_object_reference'`,
      ),
  },
  {
    store: "leads",
    source: "leads.person_id; typed custom_fields",
    query: (s) => query("leads", "l", leadMatch("l", s)),
  },
  {
    store: "notes",
    source: "notes.entity_type/entity_id, including soft-deleted notes",
    query: (s) => query("notes", "n", entityMatch("n", s), sql`'linked_entity_note'`),
  },
  {
    store: "organizations",
    source: "persons.org_id; typed organizations.custom_fields (no organization-member sweep)",
    query: (s) =>
      query(
        "organizations",
        "o",
        sql`(${contact(s, sql`o.id=(SELECT org_id FROM persons WHERE id=${s.referenceId}::uuid)`)} OR ${customReference("o", "organization", s)})`,
        sql`'subject_organization_or_typed_reference'`,
      ),
  },
  {
    store: "persons",
    source: "persons.id/primary_email/emails; typed persons.custom_fields",
    query: (s) =>
      query(
        "persons",
        "p",
        sql`(${contact(s, exact("p", s))} OR ${sharedContactAddress("p", s)} OR ${customReference("p", "person", s)})`,
        sql`CASE WHEN ${contact(s, exact("p", s))} THEN 'verified_subject' WHEN ${sharedContactAddress("p", s)} THEN 'shared_address_candidate' ELSE 'reverse_custom_reference' END`,
        sql`CASE WHEN ${contact(s, exact("p", s))} THEN 'exact' WHEN ${sharedContactAddress("p", s)} THEN 'ambiguous' ELSE 'linked' END`,
      ),
  },
  {
    store: "users",
    source: "users.id (no email-based CRM identity link)",
    query: (s) =>
      query("users", "u", user(s, exact("u", s)), sql`'verified_subject'`, sql`'exact'`),
  },
];
