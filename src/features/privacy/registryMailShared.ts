import { classifications, classifyInventory } from "./registryClassification";
import {
  mailEndpointIds1,
  mailLegacyToolingIds1,
  mailNotificationsIds1,
  mailPhoneIds1,
  mailRegionalIds1,
  mailSmsIds1,
} from "./registryIdsMailShared1";

export const mailSharedInventoryEntries = [
  classifyInventory(mailNotificationsIds1, {
    ...classifications.notifications,
    owner: "notification mail admission and immutable binding",
    categories: [
      "workforce recipient provenance",
      "rendered CRM context",
      "private send and mailbox snapshots",
      "suppression and acceptance metadata",
    ],
    purpose:
      "Bind notification mail to its original mailbox and recheck current recipient, entity access and preferences at submission.",
    disclosure:
      "Rendered context remains private and tracking is disabled. Recipient identity and a historical binding do not establish privacy scope or continued record authority.",
    retention:
      "Suppression retains content and admission metadata. Provider acceptance and private-copy state are checked before email_sent_at; unknown outcomes retain recovery obligations. No new retention or erasure adapter is activated.",
    externalEffects:
      "Existing PostgreSQL admission locks/state, private outbox snapshots and reviewed mail transport only; no new queue or independent lifecycle authority. The derived Set only detects cyclic error causes.",
  }),
  classifyInventory([...mailRegionalIds1, ...mailSmsIds1, ...mailPhoneIds1], {
    ...classifications.infrastructure,
    owner: "regional interpretation and local text conventions",
    categories: [
      "calendar/time-zone/money display preferences",
      "staged import interpretation",
      "authored phone text and country choice",
      "transient SMS encoding estimates",
    ],
    subjectRelation:
      "Display preferences identify the viewer's choices; phone parsing does not verify ownership, reachability or identity. Text supplied for estimates can concern third parties.",
    purpose:
      "Apply explicit import/display conventions, normalize phone metadata locally and estimate SMS encoding/segments without sending.",
    disclosure:
      "Cookie removal clears a display preference, not subject data. Normalization retains original authored phone text; estimates supply no disclosure, send or billing authority.",
    retention:
      "Existing preference cookies/rows and import snapshots retain their separate lifecycles. Time-zone/country/character Sets and estimates are transient; no new store or schedule is introduced.",
    externalEffects:
      "Existing preference/import persistence only. Local phone/SMS helpers make no lookup, network, send or billing call. Provider billing and non-BMP SMS behavior remain unqualified.",
  }),
  classifyInventory(mailEndpointIds1, {
    ...classifications.infrastructure,
    owner: "operator endpoint policy and DNS admission",
    categories: [
      "configured hostnames and endpoint grants",
      "approved IP/TLS metadata",
      "operator CA configuration",
    ],
    subjectRelation:
      "An endpoint grant authorizes a destination, not a user, mailbox subject or privacy case. A hostname may itself contain authored identifying metadata.",
    purpose:
      "Validate bounded operator endpoint/CA policy, canonicalize hosts and resolve/validate addresses before returning a pinned TLS endpoint.",
    disclosure:
      "The DNS boundary sends only the configured hostname to the system resolver. Credentials/content reach separately reviewed transports later; policy metadata grants no archive or secret-file access.",
    retention:
      "Static configuration and transient resolution state; no subject cache, new durable store or retention period.",
    externalEffects:
      "System DNS lookup only at this boundary; pure host canonicalization has no I/O. Subsequent SMTP/IMAP connections retain independent endpoint, TLS and actor checks.",
  }),
  classifyInventory(mailLegacyToolingIds1, {
    ...classifications.tooling,
    owner: "historical mail migration source tooling",
    categories: [
      "Git source blobs and hashes",
      "snapshot/journal metadata",
      "isolated candidate files",
      "operator output",
    ],
    subjectRelation:
      "Source history and migration metadata do not identify a CRM subject or authorize operating on installed customer data.",
    purpose:
      "Compare immutable source cuts and construct the historical platform84/local-mail88 candidate, read-only by default.",
    disclosure:
      "Reports contain source paths, digests and bounded failures. This tooling does not read a database, secrets, mailbox content or runtime configuration.",
    retention:
      "Versioned source and operator-controlled candidate/report files. SHA update markers are in-memory hashing; no receipt or applied database history is rewritten.",
    externalEffects:
      "Explicit Git read commands and filesystem reads/writes/removal of exact source candidates after HEAD/MERGE_HEAD/path checks. The historical planner refuses current canonical87/MAIL94 inputs; --write is not a canonical-main migration path and was not used for this integration.",
  }),
];
