import type { InventoryClassification } from "./registryTypes";

export const coreClassifications = {
  authentication: {
    owner: "auth",
    categories: [
      "workforce identifiers",
      "authentication secrets",
      "verification and security evidence",
    ],
    subjectRelation:
      "Account/user and verified channel links require case review; record owner is never sufficient subject proof.",
    purpose: "Authentication, access control, account recovery and security operations.",
    disclosure:
      "Exclude credentials, password hashes, TOTP/recovery secrets, bearer proofs and provider tokens. Review non-secret metadata separately.",
    retention:
      "Existing completed auth mail bodies: seven days; auth audit/outbox metadata: 180 days. Other records follow existing purpose-specific handling pending an activated policy.",
    externalEffects:
      "SMTP and Google grant revocation may occur; local disconnection and remote revocation are distinct.",
    erasureTask: "DPL-15",
  },
  crm: {
    owner: "crm",
    categories: [
      "contact identifiers",
      "relationships",
      "business data",
      "custom JSON",
      "ownership and activity history",
    ],
    subjectRelation:
      "Direct person links and indirect participant/relationship links need review; owner/author/follower identity is separate from the person concerned.",
    purpose: "Shared CRM contacts, deals, leads, organizations, activities and collaboration.",
    disclosure:
      "Reviewed subject graph and third-party field redaction required. Ownership never authorizes whole-record export or erasure.",
    retention:
      "Active CRM purge disabled until operator activation; shared records, holds and foreign keys require explicit dispositions.",
    externalEffects:
      "Imports, mail, enrichment and realtime can update or disclose linked records.",
    erasureTask: "DPL-15",
  },
  content: {
    owner: "collaboration",
    categories: ["free text", "old/new snapshots", "mentions", "embedded identifiers"],
    subjectRelation:
      "Text can concern multiple subjects; authorship/ownership does not establish who all content concerns. Manual review required.",
    purpose: "Notes, comments, change history, imported history and references.",
    disclosure:
      "No automatic full-text disclosure. Redact unrelated people and confidential context; uncertain content remains blocked for review.",
    retention:
      "No active-CRM automatic purge. Current/history copies need coordinated redaction and reviewed holds.",
    externalEffects: "Notifications, realtime and derived readers can repeat historical values.",
    erasureTask: "DPL-16",
  },
  email: {
    owner: "email",
    categories: [
      "addresses",
      "message bodies",
      "headers",
      "drafts",
      "attachments",
      "tracking",
      "provider identifiers",
    ],
    subjectRelation:
      "Sender/recipient/header/content links need review; mailbox owner is not the sole subject of a message or attachment.",
    purpose:
      "Gmail synchronization, composing, outbound delivery, thread linking and read/tracking state.",
    disclosure:
      "Third-party messages and private content excluded unless specifically approved. Never export credential material. Original MIME is not guaranteed by current records.",
    retention:
      "Current trash/archive/disconnect do not prove complete erasure; queues, draft copies, tracking and provider residuals require reviewed policy.",
    externalEffects:
      "Google OAuth/Gmail and outbound recipients. Remote data deletion is unsupported until capability and authorization receipts exist.",
    erasureTask: "DPL-16",
  },
  files: {
    owner: "files",
    categories: [
      "filenames",
      "object bodies",
      "attachment references",
      "avatars",
      "upload staging",
    ],
    subjectRelation:
      "Object uploader/owner differs from the subjects in file contents; shared references require explicit review.",
    purpose: "Private S3-compatible attachments and avatar upload/serve operations.",
    disclosure:
      "Approved references only; content and path sanitization required. Existing presigned URLs last five minutes and are not a revocable privacy delivery capability.",
    retention:
      "Existing reaper handles stale file uploads after one hour; versions, multipart, locks and avatar staging require physical qualification.",
    externalEffects:
      "Configured S3-compatible storage and browser uploads/downloads; actual bucket lock/version/residual behavior remains OPEN.",
    erasureTask: "DPL-17",
  },
} satisfies Record<string, InventoryClassification>;
