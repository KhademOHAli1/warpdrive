import { classifications, classifyInventory } from "./registryClassification";
import { archiveCodecIds1 } from "./registryIdsArchiveCodec1";
import { authenticationIds1 } from "./registryIdsAuthentication1";
import { authenticationIds2 } from "./registryIdsAuthentication2";
import { candidateDiscoveryIds1 } from "./registryIdsCandidateDiscovery1";
import { contentIds1 } from "./registryIdsContent1";
import { crmIds1 } from "./registryIdsCrm1";
import { crmIds2 } from "./registryIdsCrm2";
import { crmIds3 } from "./registryIdsCrm3";
import { disclosureContractsIds1 } from "./registryIdsDisclosureContracts1";
import { emailIds1 } from "./registryIdsEmail1";
import { emailIds2 } from "./registryIdsEmail2";
import { enrichmentIds1 } from "./registryIdsEnrichment1";
import { filesIds1 } from "./registryIdsFiles1";
import { importsIds1 } from "./registryIdsImports1";
import { infrastructureIds1 } from "./registryIdsInfrastructure1";
import { infrastructureIds2 } from "./registryIdsInfrastructure2";
import { metadataToolingIds1 } from "./registryIdsMetadataTooling1";
import { notificationsIds1 } from "./registryIdsNotifications1";
import { observabilityIds1 } from "./registryIdsObservability1";
import { personalRequestsIds1 } from "./registryIdsPersonalRequests1";
import { privacyIds1 } from "./registryIdsPrivacy1";
import { protectedSecretsIds1 } from "./registryIdsProtectedSecrets1";
import { requestServicesIds1 } from "./registryIdsRequestServices1";
import { scopeDraftIds1 } from "./registryIdsScopeDraft1";
import { stagingQualificationIds1 } from "./registryIdsStagingQualification1";
import { toolingIds1 } from "./registryIdsTooling1";
import { migrationInventoryEntry } from "./registryMigrations";
import type { RegistryEntry } from "./registryTypes";
import { workflowInventoryEntry } from "./registryWorkflows";

export const registryEntries: RegistryEntry[] = [
  workflowInventoryEntry,
  migrationInventoryEntry,
  classifyInventory([...authenticationIds1, ...authenticationIds2], classifications.authentication),
  classifyInventory([...contentIds1], classifications.content),
  classifyInventory([...crmIds1, ...crmIds2, ...crmIds3], classifications.crm),
  classifyInventory([...emailIds1, ...emailIds2], classifications.email),
  classifyInventory([...enrichmentIds1], classifications.enrichment),
  classifyInventory([...filesIds1], classifications.files),
  classifyInventory([...importsIds1], classifications.imports),
  classifyInventory([...infrastructureIds1, ...infrastructureIds2], classifications.infrastructure),
  classifyInventory([...notificationsIds1], classifications.notifications),
  classifyInventory([...observabilityIds1], classifications.observability),
  classifyInventory([...privacyIds1], classifications.privacy),
  classifyInventory([...toolingIds1], classifications.tooling),
  classifyInventory(protectedSecretsIds1, {
    ...classifications.authentication,
    owner: "authentication and installation secrets",
    categories: ["runtime credentials", "secret-file references", "shared installation keys"],
    subjectRelation:
      "Installation secret files are shared authentication infrastructure, not per-subject CRM records. File paths do not establish subject identity or disclosure authority.",
    purpose:
      "Resolve explicitly configured credential and key files at the single validated runtime environment boundary.",
    disclosure:
      "Never include secret-file contents, credentials, connection URLs or key material in subject archives, logs or routine case evidence.",
    retention:
      "Rotation, deprovisioning and host/backup lifecycle are operator-controlled. No generic CRM purge or subject case may delete shared installation secrets.",
    externalEffects:
      "The file read itself is local. Loaded secrets authorize separately classified authentication, database, mail and storage boundaries.",
    erasureTask: "DPL-13",
  }),
  classifyInventory(metadataToolingIds1, {
    ...classifications.tooling,
    owner: "maintainer source and metadata tooling",
    categories: [
      "repository source",
      "translation catalogs",
      "registry locks",
      "package version metadata",
    ],
    subjectRelation:
      "Repository/program metadata only. No subject identity or personal-data access is inferred from a source path or inventory identifier.",
    purpose:
      "Read and validate versioned source, localization baselines, shadcn snapshots, package version metadata and the source inventory itself.",
    disclosure:
      "These declarations do not authorize reading runtime secret files or producing subject archives. Reports contain source references, digests and outcomes.",
    retention:
      "Versioned source artifacts and operator-controlled local/CI reports; no personal-data retention period or purge schedule is inferred.",
    externalEffects:
      "Filesystem reads/writes of repository metadata are distinct from runtime secrets and staging input. Related tool/package-registry network effects require their own review.",
  }),
  classifyInventory(candidateDiscoveryIds1, {
    ...classifications.privacy,
    owner: "privacy candidate discovery",
    categories: [
      "reviewed subject identifiers",
      "candidate record references",
      "relationship provenance",
      "version-bound cursors",
    ],
    subjectRelation:
      "Verified contact and workforce subjects remain distinct. Shared addresses, reverse custom references and indirect graph edges are candidates requiring review; ownership does not expand identity.",
    purpose:
      "Read bounded PostgreSQL candidate IDs and relationship provenance across 18 declared candidate adapters, with 79 explicit per-table blockers.",
    disclosure:
      "Candidate metadata requires current specific case authority, fresh authentication and verification. Candidate coverage is not an immutable approved scope or authority to export full records.",
    retention:
      "Live candidate pages and encrypted version-bound cursors introduce no new durable store. Reviewed scope sealing and later artifact retention remain separate tasks.",
    externalEffects:
      "Read-only application/catalog queries and existing authorization locks. No remote content, object bytes, provider deletion or backup data is fetched.",
    erasureTask: "DPL-15",
  }),
  classifyInventory(disclosureContractsIds1, {
    ...classifications.privacy,
    owner: "privacy disclosure contract",
    categories: [
      "transient reviewed projections",
      "manifest decisions",
      "record references",
      "archive path and CSV metadata",
    ],
    subjectRelation:
      "Record IDs and field decisions must match the server-reviewed subject/scope context. Third-party and security exclusions remain explicit.",
    purpose:
      "Validate pure allowlisted projections, access versus portability manifests, safe archive paths and spreadsheet escaping before durable export integration.",
    disclosure:
      "These pure helpers do not authenticate actors or seal scope. They cannot establish current approval, content integrity, artifact generation, secure delivery or complete export coverage.",
    retention:
      "Transient in-memory representations only. No database, object or archive file is written by this contract; persisted artifact cleanup requires DPL-09/23 integration.",
    externalEffects:
      "No network, filesystem or object-storage I/O. Supplied manifest hashes are metadata and are not verified object/content receipts.",
    erasureTask: "DPL-23",
  }),
  classifyInventory(scopeDraftIds1, {
    ...classifications.privacy,
    owner: "privacy unsealed scope draft",
    categories: [
      "opaque draft and record references",
      "native record locators",
      "field and replacement descriptors",
      "provenance and source fingerprints",
      "explicit coverage blockers",
    ],
    subjectRelation:
      "Contact, workforce and external subjects stay explicit. Native locators and provenance are supplied metadata; they do not merge identities or establish current source membership.",
    purpose:
      "Canonicalize a bounded, version-bound draft of category coverage, record references and field decisions with immutable bytes, SHA-256 and explicit review blockers.",
    disclosure:
      "Every result remains unsealed, including an empty blocker list. No current authority, durable approval, verified source/replacement content or permission to disclose follows from the draft hash.",
    retention:
      "Transient in-memory metadata only. Durable scope retention, source loading and sealing require separately reviewed server integration.",
    externalEffects:
      "No database, filesystem, network, object or queue I/O. Discovered update/delete signatures are SHA-256 input and in-memory cycle-tracking operations, not persistent writers.",
    erasureTask: "DPL-23",
  }),
  classifyInventory(requestServicesIds1, {
    ...classifications.privacy,
    owner: "privacy requester and initial assignment services",
    categories: [
      "requester references",
      "encrypted own-intake metadata",
      "minimal case summaries",
      "initial reviewer membership",
      "minimal assignment receipts",
    ],
    subjectRelation:
      "A native authenticated requester supplies its own user subject and in-app recipient. Initial triage assignment does not verify identity, expand subject scope or disclose matched records.",
    purpose:
      "Create and read requester-bound cases, list minimal unassigned intake summaries and atomically claim the first reviewer membership using explicit current global authority.",
    disclosure:
      "Own-status reads expose minimal requester-bound summaries. Initial assignment requires case.assign, authority.manage and case.review; it copies only existing permitted capabilities. HTTP credentials, origin/abuse controls and localized UI remain separate integration.",
    retention:
      "Writes use existing encrypted privacy cases, memberships and minimal events. Their retention still requires operator activation; no new retention period or deletion receipt is inferred.",
    externalEffects:
      "Existing PostgreSQL reads, native authority locks, case/member writes and minimal events only. The intake queue is a live database view; no pg-boss job, object operation, email or publication occurs.",
    erasureTask: "DPL-26",
  }),
  classifyInventory(personalRequestsIds1, {
    ...classifications.privacy,
    owner: "privacy requester interface and shared HTTP/auth transport",
    categories: [
      "browser request summary and frozen retry intent",
      "requester and minimal receipt references",
      "own-case summaries, URL selectors and frozen confirmation commands",
      "transient allowlisted case-return request headers",
      "global matched CRM/authentication body copies",
      "native account security status and authentication inputs",
      "localized interface metadata",
    ],
    subjectRelation:
      "The server resolves the actor natively; path hints are not authority and the expected requester UUID is deny-only. Global non-API app/Server Action body copies can contain unrelated CRM data and authentication secrets; actor/path never determine their subject scope.",
    purpose:
      "Mount requester intake/detail routes, preserve a validated case return path through existing sign-in/pending flows, read minimal own-case status and submit exact own-account confirmation commands through existing CSRF/fresh-session Server Actions.",
    disclosure:
      "Only minimal own-case summaries and command receipts are displayed. Case status is not proof status or approval. Body copies inherit native confidentiality and are excluded from case disclosure and routine telemetry. Replay-block/autocapture declarations do not establish installed browser acceptance.",
    retention:
      "Form/case state remains in component memory; intake success does not clear its summary. Next can buffer matched request-body copies until completion/abort, under the shared finite 64mb limit. Case URLs remain linkable browser/HTTP metadata. No durable store, expiry policy or physical memory-erasure proof is introduced.",
    externalEffects:
      "The matcher excludes /api and /api/... before proxy body cloning; other matched paths scrub caller hints and stamp only validated case pathnames. Header deletion is transient, not a DB writer. Existing action body limits, native authorization and recipients remain; neither universal POST equivalence, response-body/encryption changes nor CSP nonces are established.",
    erasureTask: "DPL-26",
  }),
  classifyInventory(
    [
      ...archiveCodecIds1,
      "writer:src/features/privacy/exportArchiveStreams.ts#source.open:caller_adapter",
      "writer:src/features/privacy/exportArchive.ts#privateSink:caller_adapter",
    ],
    {
      ...classifications.privacy,
      owner: "privacy archive codec",
      categories: [
        "transient record and attachment streams",
        "reviewed manifest metadata",
        "entry and compressed-output integrity receipts",
      ],
      subjectRelation:
        "Sources and paths must correspond to the reviewed manifest. The codec does not establish who the subject is, authenticate the caller or seal a reviewed scope.",
      purpose:
        "Stream approved-path TAR/gzip content from serial caller-provided readable sources into a caller-provided writable sink, checking snapshot sizes and SHA-256 values.",
      disclosure:
        "The caller must supply authorized source adapters and a private sink. The codec neither enforces sink privacy nor authorizes publication/download. A compressed-output receipt is not storage completion or case closure.",
      retention:
        "No database/object namespace or durable job is created. Temporary/persisted sink cleanup, retries and artifact expiry require separately qualified DPL-09/23 integration.",
      externalEffects:
        "No filesystem/object/network client is instantiated. Source open(signal) and the supplied writable are explicit I/O contracts; their actual stores and destinations need their own inventory, authorization and proof.",
      erasureTask: "DPL-23",
    },
  ),
  classifyInventory(stagingQualificationIds1, {
    ...classifications.privacy,
    owner: "privacy authentication qualification",
    categories: [
      "opaque operator references",
      "staging origin and revision metadata",
      "public-response digests",
      "transient bounded input JSON",
    ],
    subjectRelation:
      "Opaque references may identify protected operator records but are not credentials, recipient addresses or identity documents. They are declarations requiring operator review.",
    purpose:
      "Prepare open installation gates and optionally observe an explicitly authorized HTTPS login origin in EN/FA/DE using anonymous locale-only requests.",
    disclosure:
      "Config input and report fields are strictly bounded and validated. Do not echo source paths, arbitrary contents, credentials, bearer URLs, cookies or response HTML into reports.",
    retention:
      "No new durable application store. Protected input JSON and CLI reports remain operator-controlled metadata with explicit future retention/access policy.",
    externalEffects:
      "Optional node:https GET /login to the configured approved origin only; certificate/hostname checks remain enabled, redirects are not followed, and wall-clock/response bounds apply. No mail, authenticated session, passkey registration or deployment occurs.",
    erasureTask: "DPL-23",
  }),

  classifyInventory(
    ["objectNamespace:object-versions", "objectNamespace:incomplete-multipart-uploads"],
    classifications.files,
  ),
  classifyInventory(
    [
      "table:pgboss-managed-schema",
      "table:drizzle-migration-metadata",
      "derived:browser-and-next-query-caches",
      "backup:postgres-volume-and-snapshots",
      "backup:object-volume-and-snapshots",
      "backup:keys-and-lifecycle-record",
      "backup:caddy-configuration-and-certificates",
    ],
    classifications.infrastructure,
  ),
  classifyInventory(
    ["log:proxy-container-host-and-ci", "external:configured-posthog"],
    classifications.observability,
  ),
  classifyInventory(
    ["external:configured-smtp-and-recipient-mailboxes", "external:google-oauth-provider"],
    classifications.authentication,
  ),
  classifyInventory(["external:apollo-rocketreach-getprospect"], classifications.enrichment),
];
