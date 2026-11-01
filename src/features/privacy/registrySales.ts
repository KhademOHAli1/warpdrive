import { classifications, classifyInventory } from "./registryClassification";
import {
  salesDesignIds1,
  salesDiagnosticsIds1,
  salesIntegrationIds1,
  salesJourneysIds1,
} from "./registryIdsSales1";

export const salesInventoryEntries = [
  classifyInventory(salesIntegrationIds1, {
    ...classifications.infrastructure,
    owner: "connected applications",
    categories: [
      "workforce custody and event provenance",
      "external workspace and channel metadata",
      "encrypted credentials and OAuth attempts",
      "provider operation outcomes",
    ],
    subjectRelation:
      "Workspace owners and OAuth actors are workforce provenance, not the subjects described by channel/account metadata or provider content. Administration and workspace identity do not establish privacy case scope.",
    purpose:
      "Maintain shared provider connections, hashed session-bound OAuth attempts and encrypted credentials; perform explicitly requested Slack code exchange, metadata reads and revocation.",
    disclosure:
      "The authenticated connection directory exposes account/channel names, scopes, owner and state metadata to every authenticated account, excluding credentials. Mutations require fresh native administrator authority and CSRF checks. Neither surface authorizes a full-row privacy export or credential disclosure.",
    retention:
      "OAuth attempts expire without a purge introduced here. Disconnect retains encrypted retry material while revocation is pending; successful revocation clears credentials and appends history. Events, attempts, backups and remote copies require separate lifecycle adapters.",
    externalEffects:
      "Slack exchange, account/channel reads and revocation contact the configured provider. Generic provider invocation dispatches trusted adapters with deadlines but does not itself authenticate callers, persist broker grants or establish remote deletion. Allowlisted message transport has no newly introduced production caller in this cut.",
  }),
  classifyInventory(salesJourneysIds1, {
    ...classifications.crm,
    owner: "sales projections, pipeline administration and saved views",
    categories: [
      "CRM rows and relationship labels",
      "authored pipeline names and audit copies",
      "saved view definitions and selected IDs",
      "transient browser query and completion state",
    ],
    subjectRelation:
      "Actor and assignee attribution differ from the people described by CRM rows, relationship labels or authored names. A shared saved view grants no records or disclosure scope.",
    purpose:
      "Compute an authorized next-action projection; administer existing pipeline state/names; admit supported saved-view selections and preserve native column/sort presentation.",
    disclosure:
      "Read projections retain current record authorization. Pipeline rename audit rows include old/new authored names, which may contain personal or confidential text. Selected view and completion state supply no independent field-export authority.",
    retention:
      "Pipeline archive is not erasure. Selected IDs persist in existing user_preferences; query rows, promise ordering and completion outcomes use browser memory. Existing audit, source-row and backup retention remain separate.",
    externalEffects:
      "Existing PostgreSQL reads, preference/pipeline writes and audit storage only. The next-action queue is a computed SQL/UI projection with no new durable queue/table. Its live client does not supply the optional completion callback; local pending state is not durable intent or exactly-once execution. Advisory locks do not establish complete cross-writer revocation fencing.",
  }),
  classifyInventory(salesDesignIds1, {
    ...classifications.tooling,
    owner: "template and qualification design catalogs",
    categories: [
      "authored template metadata",
      "bounded JSON definitions",
      "transient preview plans",
      "declared provenance and review status",
    ],
    subjectRelation:
      "Authored definitions may describe people or organizations; a preview or declared original provenance establishes neither subject identity nor rights clearance.",
    purpose: "Parse and validate bounded definitions and produce pure preview plans.",
    disclosure:
      "Preview data grants no installation, disclosure, allocation or scoring authority. Review and rights status remain pending where declared.",
    retention: "Transient parsing/planning only; no new durable store or retention schedule.",
    externalEffects:
      "No database writes, allocation, installation, external fetch or scoring. Reference URLs are validated without fetching.",
  }),
  classifyInventory(salesDiagnosticsIds1, {
    ...classifications.infrastructure,
    owner: "background queue diagnostics",
    categories: ["fixed diagnostic codes", "app or worker process label"],
    subjectRelation:
      "A process label and fixed error code do not identify a CRM subject or grant access to job payloads.",
    purpose: "Observe queue failures without forwarding the emitted error payload.",
    disclosure:
      "Only a fixed message/code and app|worker label are logged; no new payload disclosure is introduced.",
    retention: "Existing operator stdout/log retention requires installation review.",
    externalEffects:
      "Existing pg-boss behavior remains; no new production queue or external telemetry destination is added.",
  }),
];
