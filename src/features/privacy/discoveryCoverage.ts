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
    [
      "calendars",
      "calendar_members",
      "activity_reminder_settings",
      "calendar_reminder_defaults",
      "calendar_reminder_intents",
      "reminder_rebuilds",
    ],
    "unsupported",
    "Calendar ownership and membership, shared event access, personal recipient choices, durable intents and rebuild markers require dedicated subject/provenance and safe-projection adapters. Calendar owner, assignee and reminder recipient remain distinct from people mentioned in event content. Native in-app, legacy and Calendar reminder ownership does not establish subject discovery, disclosure or erasure authority. Archive, receipt visibility and delivery suppression are not lifecycle execution.",
  ),
  ...group(
    [
      "calendar_provider_accounts",
      "calendar_oauth_attempts",
      "calendar_provider_catalog_states",
      "calendar_provider_calendars",
      "calendar_provider_bindings",
    ],
    "unsupported",
    "Owned Calendar grants, hashed one-use authorization state, encrypted refresh/PKCE secrets, provider calendar metadata and local selections require credential-excluding dedicated discovery adapters. A native account or provider role does not establish the subjects of provider calendar contents. No generic credential disclosure, provider event import, remote revocation/deletion receipt or lifecycle execution is enabled by local grant purge or catalog selection.",
  ),
  ...group(
    [
      "agency_projects",
      "agency_project_members",
      "agency_project_history",
      "agency_project_requests",
      "agency_project_settings",
    ],
    "unsupported",
    "Project titles, CRM anchors, workforce memberships, immutable audit history and keyed actor-bound receipts require dedicated subject/provenance and safe-projection adapters. Native project membership and current CRM visibility grant ordinary product access only. The default-disabled module, receipt tombstones and append-only triggers establish no discovery, export, rectification, restriction, erasure or retention execution capability.",
  ),
  ...group(
    [
      "workflows_v2",
      "workflow_v2_versions",
      "workflow_v2_runs",
      "workflow_v2_executions",
      "workflow_v2_effects",
      "workflow_v2_waits",
      "workflow_v2_trigger_receipts",
      "workflow_v2_record_events",
      "workflow_v2_logic_functions",
      "workflow_v2_runtime_settings",
    ],
    "unsupported",
    "Workflow graphs, code, workforce links, form answers, copied CRM rows, provider request/result receipts and encrypted runtime credentials require dedicated provenance and lifecycle adapters. Ordinary workflow access, terminal snapshot clearing and credential replacement do not establish a subject identity, disclosure scope, remote erasure or retention authority. This declaration enables no lifecycle execution capability.",
  ),
  ...group(
    [
      "company_profiles",
      "company_legal_entities",
      "company_operations",
      "company_assets",
      "workspace_work_profiles",
      "work_types",
      "work_stages",
      "work_items",
      "work_operations",
      "work_installations",
    ],
    "unsupported",
    "Company/role/legal/payer data, encrypted receipts and branding bytes, plus workforce/CRM-linked operational records and preset snapshots, require dedicated subject/provenance and safe-projection adapters. Management, ownership, current CRM visibility and provider matches do not establish data-subject identity. Archive, pointer removal and guarded preset undo are not personal-data erasure. Provider copies, physical objects, historical receipts and backups require separate lifecycle qualification; no generic discovery, export, erasure or retention adapter is enabled.",
  ),
  ...group(
    ["billing_accounts", "billing_operations", "billing_webhook_receipts", "billing_audit_events"],
    "unsupported",
    "Merchant billing bindings, linkable operation fingerprints, provider event receipts and administrator audit references require a dedicated subject/provenance and finance-retention adapter. A payer may be a legal person, sole trader or finance contact; workspace administration does not establish data-subject identity. This declaration enables no generic export, erasure or provider deletion.",
  ),
  ...group(
    ["newsletter_operation_receipts"],
    "unsupported",
    "Actor-scoped campaign command IDs, keyed intent fingerprints and reviewed outcome references require a dedicated provenance and retention adapter. A staff actor recorded in a receipt does not identify subscribers or other people in a campaign. Keep admitted and unknown receipts fenced for replay safety. The operational Logs screen grants no generic discovery, disclosure or erasure authority.",
  ),
  ...group(
    ["email_read_intents"],
    "unsupported",
    "Actor-bound read-operation bindings, mailbox/thread references, dispatch claims and outcome timestamps require a dedicated subject/provenance and safe-projection adapter. Mailbox ownership or current administration does not establish receipt disclosure or erasure authority. Supported disconnect, deactivation, reconnect and trash retain receipts; physical purge and automatic cleanup remain inactive. Admitted/unknown barriers cannot be expired, reset, taken over or pruned. This coverage declaration grants no lifecycle execution capability.",
  ),
  ...group(
    ["activity_reminder_intents"],
    "unsupported",
    "Activity-linked reminder selections, authored time zones, generation/attempt identifiers and current delivery outcomes require reviewed subject relationships and a purpose-specific lifecycle adapter. Activity owner, assignee or notification recipient identity does not establish disclosure or erasure authority. Soft cancellation retains metadata; hard activity deletion cascades, while notification deletion clears only its link and retains the delivered tombstone. Generation replacement and current attempt counters are not an append-only history. No expiry, purge or retention period is activated; queued references, notification payloads and backups remain separate reviewed boundaries.",
  ),
  ...group(
    ["deal_create_operations"],
    "unsupported",
    "Actor-linked native deal creation receipts and intent fingerprints require a dedicated provenance and retention adapter. Deal visibility, a deleted-deal tombstone and account administration do not establish subject disclosure or erasure authority. Actor deletion remains restricted until a coordinated lifecycle is reviewed.",
  ),
  ...group(
    ["kpi_definitions", "kpi_schemes", "kpi_goals", "kpi_measurements", "kpi_snapshots"],
    "unsupported",
    "KPI definitions, version-pinned scorecard revisions, workforce assignments, manual observations and viewer-bound snapshots require a dedicated subject/provenance and lifecycle adapter. Authored calculation graphs and filters can contain record references, constants and free text. A creator, assignee, CRM contributor or snapshot viewer is not by itself a reviewed privacy subject or disclosure authority. Append-only triggers and goal archiving are product behavior, not erasure, export, rectification, restriction or retention execution. These tables are excluded from candidate discovery and no generic lifecycle capability is granted.",
  ),
  ...group(
    DISCOVERY_ADAPTER_TABLES,
    "supported",
    "Version-bound candidate IDs and explicit relationships only; content and exact approved scope require further review.",
  ),
  ...group(
    [
      "mail_connection_checks",
      "mail_folders",
      "mail_message_locators",
      "email_delivery_reports",
      "email_delivery_reviews",
      "email_private_intake",
      "email_private_intake_reviews",
    ],
    "unsupported",
    "Mailbox security proofs, folder/UID provenance, delivery-recipient evidence and duplicated private intake payloads require purpose-specific subject and lifecycle adapters. Local pointer cleanup or dismissal does not establish content erasure, credential disclosure authority or remote receipt.",
  ),
  ...group(
    ["integration_connections", "integration_events", "integration_oauth_attempts"],
    "unsupported",
    "Workspace credentials, OAuth attempt security material and connection event provenance require dedicated subject-aware adapters. Workspace ownership or current administration does not establish disclosure or remote-erasure authority.",
  ),
  ...group(
    [
      "workflows",
      "workflow_versions",
      "workflow_runs",
      "workflow_steps",
      "workflow_run_failures",
      "workflow_external_effects",
    ],
    "unsupported",
    "Workflow definitions, workforce provenance, failure/retry receipt history, trigger links and copied execution outputs need a dedicated subject/provenance adapter. Workflow ownership and history access do not establish subject identity or approved disclosure scope.",
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
