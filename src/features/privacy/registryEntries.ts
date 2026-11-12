import { agencyProjectInventoryEntry } from "./registryAgencyProjects";
import {
  analyticsAttentionInventoryEntry,
  analyticsComputationInventoryEntry,
  analyticsForecastCommitInventoryEntry,
  analyticsGovernedCustodyInventoryEntry,
  analyticsInventoryEntry,
  currentAccountConcentrationInventoryEntry,
  currentLeadHandoffInventoryEntry,
  dealReportExportInventoryEntry,
  leadLinkCaptureInventoryEntry,
  lostReasonSelectionInventoryEntry,
  nativePeriodForecastInventoryEntry,
  recordedDealSourceInventoryEntry,
  savedPerformanceInventoryEntry,
  settledForecastOutcomesInventoryEntry,
} from "./registryAnalytics";
import { billingInventoryEntry } from "./registryBilling";
import { calendarInventoryEntries } from "./registryCalendar";
import { classifications, classifyInventory } from "./registryClassification";
import { exportStorageClassification } from "./registryClassificationsExportStorage";
import { companyWorkInventoryEntry } from "./registryCompanyWork";
import { archiveCodecIds1 } from "./registryIdsArchiveCodec1";
import { authenticationIds1 } from "./registryIdsAuthentication1";
import { authenticationIds2 } from "./registryIdsAuthentication2";
import { candidateDiscoveryIds1 } from "./registryIdsCandidateDiscovery1";
import { contentIds1 } from "./registryIdsContent1";
import { coreHttpIds1, coreHttpQualificationIds1 } from "./registryIdsCoreHttp1";
import {
  coreHttpMutationQualificationIds2,
  coreHttpRuntimeIds2,
  coreHttpServiceQualificationIds2,
  coreRoleQualificationIds2,
} from "./registryIdsCoreHttp2";
import { calendarUndoIds1, crmIds1 } from "./registryIdsCrm1";
import { crmIds2 } from "./registryIdsCrm2";
import { crmIds3 } from "./registryIdsCrm3";
import { disclosureContractsIds1 } from "./registryIdsDisclosureContracts1";
import { emailIds1 } from "./registryIdsEmail1";
import { emailIds2 } from "./registryIdsEmail2";
import { enrichmentIds1 } from "./registryIdsEnrichment1";
import { exportStorageIds1 } from "./registryIdsExportStorage1";
import { filesIds1, mailboxFileAuthorizationIds1 } from "./registryIdsFiles1";
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
import { kpiInventoryEntry } from "./registryKpis";
import { mailInventoryEntries } from "./registryMail";
import { mailSharedInventoryEntries } from "./registryMailShared";
import { migrationInventoryEntry } from "./registryMigrations";
import { newsletterInventoryEntry } from "./registryNewsletter";
import { newsletterOperationalInventoryEntry } from "./registryNewsletterOperations";
import { operationsContractInventoryEntry } from "./registryOperations";
import { salesInventoryEntries } from "./registrySales";
import { salesToolingInventoryEntry } from "./registrySalesTooling";
import type { RegistryEntry } from "./registryTypes";
import {
  workflowBlocksInventoryEntry,
  workflowRuntimeInventoryEntry,
} from "./registryWorkflowBlocks";
import { workflowInventoryEntry } from "./registryWorkflows";

export const registryEntries: RegistryEntry[] = [
  agencyProjectInventoryEntry,
  analyticsInventoryEntry,
  currentAccountConcentrationInventoryEntry,
  currentLeadHandoffInventoryEntry,
  dealReportExportInventoryEntry,
  leadLinkCaptureInventoryEntry,
  lostReasonSelectionInventoryEntry,
  nativePeriodForecastInventoryEntry,
  recordedDealSourceInventoryEntry,
  savedPerformanceInventoryEntry,
  settledForecastOutcomesInventoryEntry,
  analyticsAttentionInventoryEntry,
  analyticsComputationInventoryEntry,
  analyticsForecastCommitInventoryEntry,
  analyticsGovernedCustodyInventoryEntry,
  kpiInventoryEntry,
  billingInventoryEntry,
  companyWorkInventoryEntry,
  ...calendarInventoryEntries,
  workflowInventoryEntry,
  workflowBlocksInventoryEntry,
  workflowRuntimeInventoryEntry,
  migrationInventoryEntry,
  newsletterInventoryEntry,
  newsletterOperationalInventoryEntry,
  operationsContractInventoryEntry,
  ...mailInventoryEntries,
  ...mailSharedInventoryEntries,
  salesToolingInventoryEntry,
  ...salesInventoryEntries,
  classifyInventory([...authenticationIds1, ...authenticationIds2], classifications.authentication),
  classifyInventory([...contentIds1], classifications.content),
  classifyInventory([...crmIds1, ...crmIds2, ...crmIds3], classifications.crm),
  classifyInventory(calendarUndoIds1, {
    ...classifications.crm,
    owner: "calendar schedule undo",
    categories: [
      "actor and session identifiers",
      "activity identifier and schedule values",
      "signed undo receipt",
    ],
    subjectRelation:
      "The actor and session bind the receipt to the authorized caller. Activity ownership and participant links remain separate from subject identity.",
    purpose:
      "Sign and verify an undo receipt for a confirmed calendar change. The existing calendar command checks current session, activity visibility, edit permission and the expected schedule before restoring the previous schedule.",
    disclosure:
      "Return an opaque receipt to the authenticated calendar caller. The signing key and raw session identifier stay on the server. Generic subject archives exclude the receipt and signing material.",
    retention:
      "Hold the receipt in mounted calendar state until cleared, replaced or unmounted. Schedule and reminder retention continue under their existing CRM classifications.",
    externalEffects:
      "The scanner's update writers are in-memory HMAC operations. Signing and verification create no durable receipt store and contact no provider.",
  }),
  classifyInventory([...emailIds1, ...emailIds2], classifications.email),
  classifyInventory([...enrichmentIds1], classifications.enrichment),
  classifyInventory([...filesIds1], classifications.files),
  classifyInventory(mailboxFileAuthorizationIds1, {
    ...classifications.files,
    owner: "MAIL mailbox file authorization",
    categories: [
      "mailbox and workforce identifiers",
      "current owner activity and invitation state",
    ],
    subjectRelation:
      "Mailbox ownership authorizes local file access but does not identify every subject in attachment contents. Account IDs are explicit mailbox parents, not message IDs or reviewed subject scope.",
    purpose:
      "Read the current mailbox owner and workforce status for mailbox-scoped local draft attachments. Require the active, non-invited exact owner; administrator or shared-message access does not grant mailbox-parent authority.",
    disclosure:
      "The helper returns an access decision only. It discloses no message bodies, file contents or credentials and grants no generic subject discovery, archive or disclosure authority.",
    retention:
      "This authorization check creates no durable rows, objects or retention policy. Paused or disconnected transport does not remove local draft access. Existing file metadata and object lifecycle remain separately classified.",
    externalEffects:
      "The scanner's execute:sql writer identifier represents a PostgreSQL SELECT of existing account and user rows, with cancellation checks. This helper performs no database mutation, object request, provider I/O or mailbox-owner discovery sweep.",
    erasureTask: "DPL-17",
  }),
  classifyInventory(exportStorageIds1, exportStorageClassification),
  classifyInventory([...importsIds1], classifications.imports),
  classifyInventory([...infrastructureIds1, ...infrastructureIds2], classifications.infrastructure),
  classifyInventory(coreHttpIds1, {
    ...classifications.authentication,
    owner: "Core HTTP request context",
    categories: [
      "opaque session cookie",
      "hydrated actor",
      "locale preferences",
      "CSRF request facts",
    ],
    subjectRelation:
      "The existing native cookie/session loader resolves the actor. Actor/session headers and serialized RPC inputs cannot supply request authority.",
    purpose:
      "Share request-local native authentication and Fetch tRPC handling while retaining the zero-argument React-cached Next adapter. Newsletter identity/attribution, forecast and saved-report commands validate the existing input token against server-captured cookie, Origin, Host and Sec-Fetch-Site facts; missing facts deny the command. An optional process-owned Web identity resolver is carried in every context without accepting an RPC-supplied destination.",
    disclosure:
      "Existing procedure authorization, error classification and wire shapes remain authoritative. Context creation creates no process-wide actor cache or new disclosure capability. Unexpected-error capture retains the existing actor/path/route contract.",
    retention:
      "Cookie, actor and CSRF facts remain request-local. React request caching remains confined to its Next adapter. Abort/deadline signals are cancellation requests, not proof of driver-side query termination or physical memory erasure.",
    externalEffects:
      "Existing session lookup and actor hydration read the configured database. This source seam adds no deployed API service, provider destination, queue, write replay or exclusive API data ownership; Server Actions and SSR retain their existing paths.",
  }),
  classifyInventory(coreHttpQualificationIds1, {
    ...classifications.tooling,
    owner: "Core HTTP qualification",
    categories: [
      "synthetic accounts and contacts",
      "generated native cookies and TOTP",
      "finite check results",
    ],
    subjectRelation:
      "All accounts, permissions and private contact records are newly generated synthetic fixture data; their identifiers grant no access to installed customer data.",
    purpose:
      "Exercise genuine native password/TOTP issuance, selected authorized RPC reads, direct/HTTP parity and the separately classified mutation fixture on a caller-owned disposable loopback PostgreSQL database and Bun listener.",
    disclosure:
      "Reports retain check names, bounded counts and failure stages, never passwords, cookies, TOTP material, connection URLs or contact content. Generated credentials remain transient while the real authentication flow uses them.",
    retention:
      "The harness removes its named fixture rows and closes its listener. Anonymous native rate/security residue can remain, is counted, and requires caller-owned database/cluster teardown. The retained receipt separately proves that teardown; local fixture success is not installed acceptance.",
    externalEffects:
      "Explicit isolated loopback fixture inserts, credential aging/revocation, current-auth reads and cleanup deletes. Fetch permits exactly the captured owned Core HTTP and Engine fixture origins during execution; credentials for the synthetic Engine are supplied before application imports. This is not an OS network sandbox. CookieJar delete:name is in-memory bookkeeping and execute:sql reads current_database(). No live deployment, provider submission or customer erasure is authorized.",
  }),
  classifyInventory(coreHttpRuntimeIds2, {
    ...classifications.infrastructure,
    owner: "optional Core process and public Web identity",
    categories: [
      "existing authenticated RPC request and response data",
      "runtime role and privilege admission booleans",
      "public Web version and source declaration",
      "finite process state and pending-operation markers",
    ],
    subjectRelation:
      "The complete existing router retains its native session and procedure authority. Runtime role/catalog facts and public build declarations describe installation infrastructure, not reviewed subject identity or an image digest.",
    purpose:
      "Configure an explicit bounded Core profile, admit the current runtime role and metadata-capable accepted Web ingress, and own actual HTTP, queue and metadata transport settlement through one shutdown controller. Legacy profiles retain their original connection options and inactive Core settings are ignored. A development pool profile change requires a restart rather than accumulating generations.",
    disclosure:
      "The public metadata GET contains only the versioned Web component/version/source declaration. The peer reader uses one operator-owned fixed HTTP origin, GET, no forwarded credentials or redirects, a 1 KiB decoded payload bound and short singleflight TTL. Failed peer reads never substitute Core build identity. Logs and owner notifications use fixed finite classifications, never raw SQL, URLs, credentials, request bodies or vendor diagnostics.",
    retention:
      "Request/response bytes remain transient under admitted leases until actual completion or transport cleanup; timeout and abort are not memory erasure or backend rollback proof. Queue Promise markers and metadata cache remain process-local. Unknown/rejected cleanup retains its barrier and fails the bounded drain rather than authorizing replacement work. Set delete:marker and delete:settled remove in-memory Promise bookkeeping only, not subject rows.",
    externalEffects:
      "coreRoleAdmission query:dynamic is one fixed parameterized read-only PostgreSQL catalog/configuration SELECT; core-service query:configuration is SELECT 1 readiness. Runtime admission executes no DDL or migrator. Existing producer/schema behavior and complete domain procedures remain separately authoritative. Configuration helpers create no data store; Web metadata uses the declared internal ingress. This inventory does not establish accepted routing, exclusive write ownership, whole-router domain retirement coverage, image publication or installed acceptance.",
  }),
  classifyInventory(coreHttpMutationQualificationIds2, {
    ...classifications.tooling,
    owner: "Core HTTP mutation qualification fixture",
    categories: [
      "synthetic persons, leads, newsletter bindings and exposure receipts",
      "synthetic saved filters and captured deal roster",
      "finite denial, replay and cleanup facts",
    ],
    subjectRelation:
      "All fixture people, actors, addresses, business records and remote exposure identifiers are newly generated synthetic data in an explicitly owned disposable database and Engine. They establish no authority over installed subjects or external subscribers.",
    purpose:
      "Exercise real cookie-authenticated HTTP CSRF denials without business/Engine effects and successful detach, durable attribution replay, captured-roster forecast, and saved-report create/remove paths. Domain transaction, audit and unknown/replay semantics remain unchanged.",
    disclosure:
      "Fetch is restricted to the two captured loopback fixture origins; Engine control requires a generated nonce and business calls use generated fixture credentials. Reports expose bounded counts, check stages and outcome flags, not credentials, cookies, contact content or connection URLs. This is a local fixture transport guard, not a network sandbox.",
    retention:
      "Named business rows are removed with every cleanup attempt observed, but identity/audit/history and authentication residue may require complete caller-owned database/cluster teardown. The fixture supervisor owns Engine/Core listeners, groups and resource receipts. Passing checks and source pins do not establish provider, final-image or installed acceptance.",
    externalEffects:
      "Scanner insert/delete identities are actual fixture DML for persons, newsletter bindings, exposure receipts, leads, saved filters, audits and captured-history rows. execute:sql snapshots only this fixture's business tables; query:dynamic reads its database clock. Controlled Engine endpoints return synthetic capabilities/exposures and record one revoke; no live newsletter delivery, publication or customer erasure is authorized.",
  }),
  classifyInventory(coreRoleQualificationIds2, {
    ...classifications.tooling,
    owner: "Core runtime-role qualification fixture",
    categories: ["synthetic PostgreSQL roles and grants", "finite admission and cleanup outcomes"],
    subjectRelation:
      "The fixture uses fixed synthetic owner/runtime roles and a generated disposable PostgreSQL database. Role names, catalog observations and grant paths are infrastructure test facts, not customer records or installed authorization.",
    purpose:
      "Qualify the production read-only catalog admission against allowed runtime grants and unsafe ownership, memberships, privilege escalation and switched-role cases, including a held-catalog timeout. The exact source/native receipt is distinct from deployment or image acceptance.",
    disclosure:
      "The filesystem boundary reads only supervisor-supplied loopback fixture configuration with the fixed fixture database and role names; the supervisor receipt separately proves ownership. Logs contain fixed case/outcome fields without connection URLs, passwords, raw catalog rows or native exception contents.",
    retention:
      "Owner/runtime connections, held locks, role/schema/table mutations and generated fixture configuration belong to the caller-owned disposable cluster lifecycle. Independent process/socket/directory cleanup must be retained; source coverage alone cannot prove cleanup or grant a generic erasure adapter.",
    externalEffects:
      "query:config runs the production parameterized catalog SELECT. query:statement and query:dynamic also cover real fixed fixture bootstrap/cleanup DDL and GRANT/REVOKE, not merely reads. Explicit BEGIN/LOCK/ROLLBACK hold only the owned catalog-lock probe; GRANT/SET ROLE/RESET ROLE/REVOKE test effective identity in the fixture. Production runtime admission never performs these fixture mutations. No provider, customer, production-role provisioning or runtime migration is authorized.",
  }),
  classifyInventory(coreHttpServiceQualificationIds2, {
    ...classifications.tooling,
    owner: "real Core entrypoint qualification fixture",
    categories: [
      "synthetic native users, contacts, sessions and saved reports",
      "generated fixture environment and native credentials",
      "owned child handles, private diagnostics and finite check facts",
    ],
    subjectRelation:
      "The supplied configuration names one isolated loopback core_service_fixture database and synthetic owner/runtime roles. Canonical private scratch/configuration checks follow parsing; a random marker read from the actual cluster must match before owner migrations. The external supervisor retains cluster, directory and process custody evidence.",
    purpose:
      "Run the actual Core entrypoint against canonical/queue migrations in the disposable owner fixture, restricted runtime admission, native password-issued cookies and a synthetic public Web metadata server. Observe owner isolation, saved-report CSRF/create/remove, independent metadata refresh, producer-only registry state, native signals and failed startup. Source classification does not assert those checks passed.",
    disclosure:
      "HTTP fetch targets are derived only from captured owned loopback child and metadata listeners. Public proof logs retain finite stages, outcomes, counts and child handles. The supplied configuration contains generated environment/connection material; bounded raw child stdout/stderr are private scratch diagnostics, not automatically credential-free public evidence. No customer/provider destination or user credential forwarding to metadata is authorized.",
    retention:
      "Filesystem reads load the supplied fixture configuration before its post-parse path guard. Writes/atomic rename create private 0600 child/metadata manifests and bounded child logs under checked scratch; file/libpq environment overrides are not forwarded. All-settled cleanup attempts each child and resource; independent supervisor descendant verification and cluster/directory teardown remain required. All synthetic rows and runtime role grants require disposable database teardown, not installed acceptance.",
    externalEffects:
      "insert:dynamic is actual synthetic fixture seeding. The CREATE ROLE/REVOKE/GRANT statement and explicit owner migrator perform real fixture DDL; query:none/dynamic also cover owner setup and reads. The nonce current_setting SELECT only attests fixture context; the three listed pg_stat_activity/pgboss.instance SELECTs only observe backend and producer facts. delete:response is in-memory ServerResponse Set bookkeeping. Child startup, signals and metadata sockets are local qualification resources, not publication, accepted ingress cutover or a production deployment.",
  }),
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
      "Read bounded PostgreSQL candidate IDs and relationship provenance through the declared candidate adapters, with explicit blockers for every other reviewed store.",
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
      "deny-only reviewer form selectors",
    ],
    subjectRelation:
      "A native authenticated requester supplies its own user subject and in-app recipient. Initial triage assignment does not verify identity, expand subject scope or disclose matched records.",
    purpose:
      "Create and read requester-bound cases, list minimal unassigned intake summaries and atomically claim the first reviewer membership using explicit current global authority. Reviewer Server Actions forward only the actor and session from fresh native resolution.",
    disclosure:
      "Own-status reads expose minimal requester-bound summaries. Initial assignment requires case.assign, authority.manage and case.review; it copies only existing permitted capabilities. Reviewer actions use existing CSRF/fresh-session guards and a deny-only stale-form selector. Real HTTP/native-auth acceptance, abuse controls and localized reviewer UI remain separate integration.",
    retention:
      "Writes use existing encrypted privacy cases, memberships and minimal events. Their retention still requires operator activation; no new retention period or deletion receipt is inferred.",
    externalEffects:
      "Existing PostgreSQL reads, native authority locks, case/member writes and minimal events only. The intake queue is a live database view; no pg-boss job, object operation, email or publication occurs.",
    erasureTask: "DPL-26",
  }),
  classifyInventory(personalRequestsIds1, {
    ...classifications.privacy,
    owner: "privacy requester/reviewer interfaces and shared HTTP/auth transport",
    categories: [
      "browser request summary and frozen retry intent",
      "requester and minimal receipt references",
      "own-case summaries, URL selectors and frozen confirmation commands",
      "minimal reviewer intake pages and frozen assignment commands/receipts",
      "authorized original case intake and preliminary exact-subject projections",
      "transient allowlisted case-return request headers",
      "global matched CRM/authentication body copies",
      "native account security status and authentication inputs",
      "localized interface metadata",
    ],
    subjectRelation:
      "The server resolves the actor natively; path hints are not authority and expected requester/reviewer UUIDs are deny-only. Reviewer assignment does not establish subject identity or authorize case-content disclosure. Global non-API app/Server Action body copies can contain unrelated CRM data and authentication secrets; actor/path never determine their subject scope.",
    purpose:
      "Mount requester intake/detail routes, preserve a validated case return path, read minimal own-case status and submit exact own-account confirmation commands. The root also offers explicit paged reviewer triage and frozen assignment retries through existing CSRF/fresh-session Server Actions, and exact-case reviewer reads without a new route. Original intake requires current assigned case.review; preliminary native projections require current case.review plus case.disclose, verified identity and active disclosure policy.",
    disclosure:
      "Own-case summaries remain requester-bound. Reviewer intake requires current case.assign authority; initial claim additionally requires authority.manage and case.review. Original intake stays distinct from current identity evidence; projections are explicitly incomplete and grant no scope approval. Minimal rows/receipts and reviewer content clear on current access or security denial; an assignment receipt is historical, not proof of current ownership or approval. Body copies remain excluded from disclosure/telemetry. Replay masking does not establish installed browser acceptance.",
    retention:
      "Form/case/queue state and frozen unknown-result intents remain in component memory; intake success does not clear the personal summary. Identity changes clear displayed reviewer data and suppress late results. Next can buffer matched request bodies under the existing 64mb limit. Case URLs remain linkable metadata. No durable browser store, expiry policy or physical memory-erasure proof is introduced.",
    externalEffects:
      "The matcher excludes /api and /api/... before proxy body cloning; other matched paths scrub caller hints and stamp only validated case pathnames. Header deletion is transient, not a DB writer. The shared app layout also derives a canViewProjects navigation boolean through current native project admission. This projection contains no project titles, rows, CRM anchors, memberships or request receipts; showing navigation grants no project access. Existing action body limits, native authorization and recipients remain; neither universal POST equivalence, response-body/encryption changes nor CSP nonces are established.",
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
