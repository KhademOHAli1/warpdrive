import { classifications, classifyInventory } from "./registryClassification";
import {
  mailCredentialsIds1,
  mailDeliveryIds1,
  mailOutboxIds1,
  mailPrivateIntakeIds1,
  mailSyncIds1,
} from "./registryIdsMail1";

export const mailInventoryEntries = [
  classifyInventory(mailCredentialsIds1, {
    ...classifications.email,
    owner: "mailbox configuration and connection proofs",
    categories: [
      "workforce/session provenance",
      "mailbox addresses and endpoints",
      "encrypted credentials and PKCE",
      "hashed connection proofs and capability state",
    ],
    subjectRelation:
      "Mailbox owners and proof actors identify workforce provenance, not every person described by mailbox content, endpoint labels or provider data.",
    purpose:
      "Validate and configure explicitly authorized mailbox endpoints and consume session-bound connection proofs.",
    disclosure:
      "Credentials, PKCE and proof material are excluded from subject archives and ordinary diagnostics. A credential-free mailbox status projection supplies no content disclosure authority.",
    retention:
      "Proofs expire after ten minutes; consumption clears ciphertext and maintenance prunes expired/consumed/invalid-session proofs. Persistent credentials stay encrypted. Disconnect clears local credentials and queues applicable Google revocation while retaining content; remote completion requires separate evidence.",
    externalEffects:
      "Connection validation authenticates to separately classified approved endpoints. Endpoint permission does not grant user or privacy authority. No subject lifecycle capability follows from a successful connection check.",
  }),
  classifyInventory(mailDeliveryIds1, {
    ...classifications.email,
    owner: "private delivery observations",
    categories: [
      "unverified recipient addresses and diagnostics",
      "provider/MTA/envelope identifiers",
      "dates and extensions",
      "reviewer attribution, recipient snapshots and attempt hashes",
    ],
    subjectRelation:
      "A report may concern multiple recipients and nested/forwarded content. Mailbox ownership or matching an attempt is not proof of subject identity or of the report's claims.",
    purpose:
      "Retain observed report provenance and owner-only association/dismissal annotations without changing submission facts.",
    disclosure:
      "Recipient snapshots and diagnostic text may contain third-party information. Review access establishes no approved privacy scope or resend authority.",
    retention:
      "Deleting an attempt clears its pointer while retaining recipient snapshot, hash and review history. Immutable evidence needs purpose-specific retention/redaction; dismissal is attention state rather than erasure.",
    externalEffects:
      "Existing local mailbox/report ingestion and review records only. An observation or annotation neither resends mail nor proves recipient delivery or remote deletion.",
  }),
  classifyInventory(mailPrivateIntakeIds1, {
    ...classifications.email,
    owner: "private mail intake and review evidence",
    categories: [
      "duplicated observed provider/MIME payloads",
      "private bodies, addresses and base64 content",
      "provider identifiers and hashes",
      "confirmation snapshots and reviewer history",
    ],
    subjectRelation:
      "Private mailbox ownership controls access but does not identify every subject in duplicated bodies, attachments, reports or retained provenance.",
    purpose:
      "Isolate observed private messages and retain explicit receipt, confirmation and review evidence under database guards.",
    disclosure:
      "Stored observed payloads can contain full sensitive Gmail or parsed IMAP content in addition to private message/thread rows. Generic privacy disclosure must not copy full rows or infer scope from the owner.",
    retention:
      "Message deletion purges duplicated observed_payload but retains provider IDs, hashes, confirmation snapshots and review history; account cascades have a broader local effect. Neither rule establishes whole-subject erasure, remote deletion or backup cleanup.",
    externalEffects:
      "Local intake, guarded evidence and owner review only. Review decisions change attention state and do not authorize sending, provider mutation or subject lifecycle execution.",
  }),
  classifyInventory(mailSyncIds1, {
    ...classifications.email,
    owner: "mail synchronization and configured remote operations",
    categories: [
      "message and parsed MIME content",
      "folder paths and UID epochs",
      "flags, fingerprints and checkpoints",
      "transient transport state and provider outcomes",
    ],
    subjectRelation:
      "Folder/UID/account links establish mailbox storage provenance, not reviewed subjects. Message parties and content can concern unrelated people.",
    purpose:
      "Synchronize configured Gmail/IMAP mailboxes and perform explicitly requested message read/flag/move/trash operations.",
    disclosure:
      "Credentials and raw transport errors are excluded from routine diagnostics and generic archives. Content and private rows retain current mailbox/record authority and field-level review requirements.",
    retention:
      "historyDays limits synchronization horizon without scheduling deletion. Local message/account cascades cover linked metadata only; remote flags, archive/trash state, provider copies and backups need independent lifecycle handling.",
    externalEffects:
      "IMAP sessions authenticate to approved pinned endpoints, read MIME, change flags and move/trash messages; Gmail contacts Google. SDK callbacks are manually reviewed, logging is disabled and transports close on cancellation. These operations do not qualify privacy erasure or a remote receipt.",
  }),
  classifyInventory(mailOutboxIds1, {
    ...classifications.email,
    owner: "mail drafts, send snapshots, attachments and recovery",
    categories: [
      "To/CC/BCC and authored draft content",
      "durable send intent and recipient outcomes",
      "attachment bytes/locators/hashes",
      "tracking choices, notification copies and recovery references",
    ],
    subjectRelation:
      "Sender, mailbox owner and notification recipient differ from subjects copied into message bodies, attachments and recipient lists. Intent/idempotency keys do not establish disclosure authority.",
    purpose:
      "Preserve explicit send snapshots, submit through approved providers and recover known or uncertain outcomes without inferring a safe resend.",
    disclosure:
      "Snapshots and BCC contain sensitive multi-subject data. Attachment downloads recheck current access after I/O. A submission result or tracking choice establishes no approved privacy projection.",
    retention:
      "SMTP copies immutable attachments under mail/<account>/<attempt>/<random>; object keys/hashes and optional sent copies outlive individual rows. No corresponding mail-object cleanup is established here. Accepted, partial and unknown submissions retain distinct recovery obligations; local deletion is not erasure.",
    externalEffects:
      "SMTP transmits MIME and envelope recipients; optional IMAP append creates sent copies. email.recovery repairs existing queues using account/idempotency references. Tracking follows explicit choices; notification mail stays private and disables tracking. Remote acceptance, delivery and object/backup lifecycle require separate receipts.",
  }),
];
