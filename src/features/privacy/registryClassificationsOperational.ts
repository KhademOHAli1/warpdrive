import type { InventoryClassification } from "./registryTypes";

export const operationalClassifications = {
  imports: {
    owner: "import",
    categories: ["raw CSV", "raw JSON", "row snapshots", "mapping identifiers", "failure detail"],
    subjectRelation:
      "Imported owner fields are not identity evidence. Rows may contain multiple people and aliases requiring case review.",
    purpose: "CSV staging, prepare/validate/commit/undo and cross-import mappings.",
    disclosure:
      "Raw source/validation snapshots can include third-party or obsolete values. Reviewed field-level scope required.",
    retention:
      "Undo/soft deletion is not erasure. Raw files, rows, batch previews, change-log copies and stale jobs need coordinated policy and fences.",
    externalEffects:
      "S3-compatible source objects, pg-boss payloads, CRM writes, reminders and notifications.",
    erasureTask: "DPL-16",
  },
  enrichment: {
    owner: "enrichment",
    categories: [
      "search identifiers",
      "normalized provider outcomes",
      "API credentials",
      "prospect caches",
      "applied fields",
    ],
    subjectRelation:
      "Provider matches are advisory; addresses/shared names cannot automatically merge people. Reviewed provenance required.",
    purpose: "Apollo, RocketReach and GetProspect lookups/reveals and reviewed CRM application.",
    disclosure:
      "Exclude provider API credentials; normalized outcomes/profiles can involve unrelated people and require review.",
    retention:
      "Provider/cache TTL and source copies are not whole-subject erasure; operator contracts and retention decisions remain OPEN.",
    externalEffects:
      "External enrichment providers receive search inputs. Remote correction/revocation/deletion capability is not established.",
    erasureTask: "DPL-18",
  },
  notifications: {
    owner: "notifications",
    categories: ["recipient identifiers", "notification payloads", "email outcomes", "preferences"],
    subjectRelation:
      "Notification recipient differs from subjects copied into body/payload. Review all referenced records and people.",
    purpose: "In-app notifications and queued recipient delivery.",
    disclosure:
      "No blanket recipient-mailbox disclosure; scrub erased content and private related records before publication.",
    retention:
      "No universal notification retention mandate; metadata, queued payloads and sent copies require reviewed policy.",
    externalEffects:
      "pg-boss, in-app readers and configured delivery boundary; external delivery requires installation proof.",
    erasureTask: "DPL-16",
  },
  privacy: {
    owner: "privacy",
    categories: [
      "case references",
      "authority",
      "encrypted case metadata",
      "job state",
      "minimal transitions",
    ],
    subjectRelation:
      "Opaque case IDs and reviewed subject links only; owner/actor does not prove subject identity.",
    purpose: "Explicit privacy authority, case lifecycle and source coverage controls.",
    disclosure:
      "Specific privacy capability, case scope, current account authority and fresh authentication required. Sensitive metadata stays encrypted.",
    retention:
      "Case retention needs operator activation; 180 days is only a proposed starting point. No destructive schedule inferred from locale.",
    externalEffects: "No external communication is authorized merely by a case/job completion.",
    erasureTask: "DPL-26",
  },
  infrastructure: {
    owner: "platform",
    categories: [
      "session references",
      "realtime payloads",
      "query caches",
      "rate-limit state",
      "settings and preferences",
    ],
    subjectRelation:
      "Actor/owner/session keys identify processors or recipients and are not automatically the subject of cached records. Review required.",
    purpose:
      "Realtime delivery, derived views, preferences, authorization caches and service operations.",
    disclosure:
      "No independent disclosure authority; cache/realtime content inherits reviewed source and current access restrictions.",
    retention:
      "Transient state ends with process/browser lifecycle unless explicitly persisted; invalidation after commit and restore admission require qualification.",
    externalEffects:
      "Browser caches, PostgreSQL LISTEN/NOTIFY, WebSocket clients and configured service dependencies.",
    erasureTask: "DPL-18",
  },
  observability: {
    owner: "observability",
    categories: ["employee identity", "event properties", "error text", "request/device metadata"],
    subjectRelation:
      "PostHog identifies the authenticated employee with name/email/role. Error/content properties can concern other subjects and require review.",
    purpose:
      "Optional analytics, session replay masking, diagnostics and configured console forwarding.",
    disclosure:
      "Routine logs/audits must not copy secrets or erased content. Existing property scrubbing does not establish remote deletion.",
    retention:
      "Provider retention and deletion contracts are unknown operator decisions; stdout/container and proxy logs need installation inventory.",
    externalEffects:
      "Configured PostHog host and log sinks; telemetry disabled when configuration is absent. Remote deletion unsupported.",
    erasureTask: "DPL-23",
  },
  tooling: {
    owner: "maintainers",
    categories: ["source artifacts", "synthetic fixtures", "operator DB access"],
    subjectRelation:
      "Seed users are synthetic only when run as documented; ownership is not authority to erase actual data. Operator review required.",
    purpose: "Migration, source tooling, checks and disposable fixture creation.",
    disclosure:
      "Tooling output must omit credentials/real customer values. Source inventory does not authorize running seeds on a live installation.",
    retention:
      "Operator-controlled work directories and terminal/CI logs; actual destinations and retention require review.",
    externalEffects:
      "Package registries, source registries, DB connections and filesystem artifacts as explicitly invoked.",
    erasureTask: "DPL-35",
  },
} satisfies Record<string, InventoryClassification>;
