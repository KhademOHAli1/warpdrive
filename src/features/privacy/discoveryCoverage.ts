import { DISCOVERY_ADAPTER_TABLES } from "./discoveryTypes";

type Status = "supported" | "review_required" | "unsupported";
export interface DiscoveryCoverage {
  store: string;
  status: Status;
  scope: "candidate_links_only";
  reason: string;
}
function group(stores: readonly string[], status: Status, reason: string): DiscoveryCoverage[] {
  return stores.map((store) => ({ store, status, scope: "candidate_links_only", reason }));
}

// Literal reviewed declarations deliberately do not learn new tables from the catalog.
export const DISCOVERY_COVERAGE: readonly DiscoveryCoverage[] = [
  ...group(
    DISCOVERY_ADAPTER_TABLES,
    "supported",
    "Version-bound candidate IDs and explicit relationships only; content and exact approved scope require further review.",
  ),
  ...group(
    ["integration_connections", "integration_events", "integration_oauth_attempts"],
    "unsupported",
    "Workspace credentials, OAuth attempt security material and connection event provenance require dedicated subject-aware adapters. Workspace ownership or current administration does not establish disclosure or remote-erasure authority.",
  ),
  ...group(
    ["workflows", "workflow_versions", "workflow_runs", "workflow_steps"],
    "unsupported",
    "Workflow definitions, workforce provenance, trigger links and copied execution outputs need a dedicated subject/provenance adapter. Workflow ownership and history access do not establish subject identity or approved disclosure scope.",
  ),
  ...group(
    [
      "auth_accounts",
      "auth_email_verification_tokens",
      "auth_integration_revocations",
      "auth_invitations",
      "auth_mail_outbox",
      "auth_passkeys",
      "auth_policies",
      "auth_rate_limits",
      "auth_recovery_requests",
      "auth_security_events",
      "auth_totp_replays",
      "auth_two_factors",
      "auth_verifications",
      "oauth_access_tokens",
      "oauth_auth_codes",
      "oauth_clients",
      "oauth_refresh_tokens",
      "sessions",
      "ws_tickets",
      "email_accounts",
      "email_send_attempts",
      "email_tracking_tokens",
      "enrichment_providers",
    ],
    "unsupported",
    "Credential, outbox or security records need a separate purpose-specific safe projection; this adapter never returns their contents or credential identifiers.",
  ),
  ...group(
    [
      "privacy_authority",
      "privacy_case_events",
      "privacy_case_members",
      "privacy_case_verifications",
      "privacy_cases",
      "privacy_deadline_decisions",
      "privacy_deadline_records",
      "privacy_jobs",
      "privacy_policy_drafts",
      "privacy_policy_state",
      "privacy_policy_versions",
    ],
    "review_required",
    "Protected privacy evidence can concern other subjects or cases and needs separate case authority, retention and minimization review.",
  ),
  ...group(
    ["import_batches", "import_external_ids", "import_rows"],
    "review_required",
    "Multi-subject raw/mapped source and update-mode provenance need a dedicated import adapter, including rows without created record IDs.",
  ),
  ...group(
    ["enrichment_field_mappings", "enrichment_runs", "enrichment_settings", "prospect_reveals"],
    "review_required",
    "Normalized candidates, detached reveal profiles and recipient follow-up need a separate provenance adapter; provider identity is not proof.",
  ),
  ...group(
    [
      "email_message_attachments",
      "email_templates",
      "email_thread_reads",
      "email_tracking_events",
      "mail_labels",
      "signatures",
    ],
    "review_required",
    "Mail metadata and provider attachment references need mailbox-composite and third-party review; no remote content is fetched.",
  ),
  ...group(
    [
      "activity_types",
      "app_release_status",
      "audit_events",
      "channel_versions",
      "contact_followers",
      "deal_followers",
      "deal_labels",
      "goals",
      "hidden_builtin_fields",
      "labels",
      "lead_labels",
      "lost_reasons",
      "mentions",
      "notification_preferences",
      "notifications",
      "org_labels",
      "organization_relations",
      "permission_sets",
      "person_labels",
      "pipelines",
      "saved_filters",
      "settings",
      "stages",
      "team_members",
      "teams",
      "user_preferences",
      "visibility_group_members",
      "visibility_groups",
    ],
    "review_required",
    "Membership, ownership, notification, configuration and derived relationships need purpose-specific review; ownership never expands subject content scope.",
  ),
];

export function checkDiscoveryCoverage(stores: readonly string[]) {
  const known = new Set<string>();
  const invalid: string[] = [];
  for (const entry of DISCOVERY_COVERAGE) {
    if (known.has(entry.store) || entry.reason.trim().length === 0) invalid.push(entry.store);
    known.add(entry.store);
  }
  const missing = stores.filter((store) => !known.has(store));
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}
